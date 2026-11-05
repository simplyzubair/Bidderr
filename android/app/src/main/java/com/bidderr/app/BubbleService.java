package com.bidderr.app;

import android.accessibilityservice.AccessibilityService;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.HapticFeedbackConstants;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayDeque;

/**
 * The optional floating "B" bubble (an accessibility service, so it can float over other apps
 * and paste for the user).
 *   idle    - green B over browsers and job apps. Tap: read the job on screen and write.
 *   writing - the B pulses while the proposal is written.
 *   ready   - turns into a green "Paste" pill. Tap the proposal box, then the pill: pasted.
 * The Quick Settings tile (BubbleTileService) can pause it: hidden everywhere until turned back on.
 * Long-press the bubble: a ring of round buttons opens around it (stop, copy again, open, hide, ...).
 */
public class BubbleService extends AccessibilityService {
    private static final int MAX_NODES = 4000;
    private static final int MAX_CHARS = 15000;
    private static final long READY_TIMEOUT_MS = 3 * 60 * 1000;
    private static final long LONG_PRESS_MS = 600;
    private static final long RING_TIMEOUT_MS = 6000;
    private static final long SNOOZE_MS = 30 * 60 * 1000;

    private static BubbleService instance;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private WindowManager windowManager;
    private LinearLayout bubble;
    private ImageView icon;
    private TextView label;
    private WindowManager.LayoutParams params;
    private ObjectAnimator pulse;
    private String state = "idle";
    private String proposal = "";
    private boolean inJobApp;
    private float dp;
    private FrameLayout ring;
    private final Runnable backToIdle = () -> setState("idle", "");
    private final Runnable closeRing = this::closeRing;
    private final Runnable snoozeOver = this::updateVisibility;

    // ---------- called by WriterActivity ----------

    static boolean isRunning() {
        return instance != null;
    }

    static boolean isPaused(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("bubble", MODE_PRIVATE);
        // "pausedUntil" is the 30 minute snooze; once the time has passed it counts for nothing.
        return prefs.getBoolean("paused", false) || System.currentTimeMillis() < prefs.getLong("pausedUntil", 0);
    }

    static void setPaused(Context context, boolean paused) {
        SharedPreferences.Editor edit = context.getSharedPreferences("bubble", MODE_PRIVATE).edit().putBoolean("paused", paused);
        if (!paused) edit.remove("pausedUntil");
        edit.apply();
        MAIN.post(() -> {
            if (instance != null) instance.updateVisibility();
        });
    }

    static void signal(String newState, String text) {
        MAIN.post(() -> {
            if (instance != null) instance.setState(newState, text);
        });
    }

    // ---------- service ----------

    @Override
    protected void onServiceConnected() {
        instance = this;
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        dp = getResources().getDisplayMetrics().density;
        addBubble();
        // The app in front may already be a browser (no "window changed" event will come for it).
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root != null && root.getPackageName() != null) {
            inJobApp = isJobApp(root.getPackageName().toString().toLowerCase());
        }
        setState("idle", "");
    }

    @SuppressLint("ClickableViewAccessibility")
    private void addBubble() {
        bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.HORIZONTAL);
        bubble.setGravity(Gravity.CENTER_VERTICAL);
        bubble.setElevation(8 * dp);

        icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_launcher_foreground);
        icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
        bubble.addView(icon, new LinearLayout.LayoutParams((int) (56 * dp), (int) (56 * dp)));

        label = new TextView(this);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setTextColor(Color.rgb(2, 44, 34));
        label.setPadding(0, 0, (int) (18 * dp), 0);
        bubble.addView(label);

        params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        resetPosition();

        // Drag to move it, tap to act.
        bubble.setOnTouchListener(new View.OnTouchListener() {
            private int startX, startY;
            private float touchX, touchY;
            private boolean moved;
            private boolean longPressed;
            private final Runnable longPress = () -> {
                longPressed = true;
                bubble.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                openRing();
            };

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = params.x;
                        startY = params.y;
                        touchX = e.getRawX();
                        touchY = e.getRawY();
                        moved = false;
                        longPressed = false;
                        MAIN.postDelayed(longPress, LONG_PRESS_MS);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - touchX);
                        int dy = (int) (e.getRawY() - touchY);
                        if (!longPressed && (Math.abs(dx) > 12 * dp || Math.abs(dy) > 12 * dp)) {
                            moved = true;
                            MAIN.removeCallbacks(longPress);
                        }
                        if (moved && !longPressed) {
                            params.x = startX + dx;
                            params.y = startY + dy;
                            windowManager.updateViewLayout(bubble, params);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        MAIN.removeCallbacks(longPress);
                        if (!moved && !longPressed) onBubbleTapped();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        MAIN.removeCallbacks(longPress);
                        return true;
                }
                return false;
            }
        });

        windowManager.addView(bubble, params);
    }

    // Default spot: right edge, middle of the screen.
    private void resetPosition() {
        params.x = getResources().getDisplayMetrics().widthPixels - (int) (64 * dp);
        params.y = getResources().getDisplayMetrics().heightPixels / 2;
        if (bubble.isAttachedToWindow()) windowManager.updateViewLayout(bubble, params);
    }

    // ---------- action ring (long-press) ----------

    private void openRing() {
        if (ring != null || bubble == null) return;
        int size = (int) (220 * dp);
        int screenW = getResources().getDisplayMetrics().widthPixels;
        int screenH = getResources().getDisplayMetrics().heightPixels;
        int cx = params.x + bubble.getWidth() / 2;
        int cy = params.y + bubble.getHeight() / 2;
        int x = Math.max(0, Math.min(screenW - size, cx - size / 2));
        int y = Math.max(0, Math.min(screenH - size, cy - size / 2));

        ring = new FrameLayout(this);
        // A tap on empty space inside the ring, or outside it, closes it.
        ring.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_OUTSIDE || e.getAction() == MotionEvent.ACTION_DOWN) closeRing();
            return true;
        });

        boolean writing = "writing".equals(state);
        boolean hasProposal = !proposal.isEmpty();
        int[] icons = {R.drawable.ic_ring_stop, R.drawable.ic_ring_copy, R.drawable.ic_ring_open,
                R.drawable.ic_ring_hide, R.drawable.ic_ring_snooze, R.drawable.ic_ring_reset};
        String[] names = {"Stop writing", "Copy proposal again", "Open Bidderr", "Hide bubble",
                "Pause for 30 minutes", "Reset position"};
        boolean[] enabled = {writing, hasProposal, true, true, true, true};
        Runnable[] actions = {this::ringStop, this::ringCopy, this::ringOpen, this::ringHide, this::ringSnooze,
                this::ringReset};
        double radius = 80 * dp;
        for (int i = 0; i < 6; i++) {
            double angle = Math.toRadians(-90 + i * 60); // clockwise from the top
            int bx = (int) (size / 2 + radius * Math.cos(angle));
            int by = (int) (size / 2 + radius * Math.sin(angle));
            addRingButton(bx, by, 44, icons[i], Color.parseColor("#F3F4F6"), false, names[i], enabled[i], actions[i]);
        }
        addRingButton(size / 2, size / 2, 40, R.drawable.ic_ring_close, Color.parseColor("#FB7185"), true,
                "Close menu", true, () -> { });

        WindowManager.LayoutParams rp = new WindowManager.LayoutParams(size, size,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
                PixelFormat.TRANSLUCENT);
        rp.gravity = Gravity.TOP | Gravity.START;
        rp.x = x;
        rp.y = y;
        windowManager.addView(ring, rp);
        MAIN.postDelayed(closeRing, RING_TIMEOUT_MS);
    }

    // One round button centred on (cx, cy) inside the ring. Runs the action, then closes the ring.
    private void addRingButton(int cx, int cy, int sizeDp, int iconRes, int color, boolean whiteIcon, String name,
                               boolean enabled, Runnable action) {
        int px = (int) (sizeDp * dp);
        ImageView b = new ImageView(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(color);
        b.setBackground(bg);
        b.setElevation(4 * dp);
        b.setImageResource(iconRes);
        int pad = (int) ((sizeDp - 24) / 2f * dp);
        b.setPadding(pad, pad, pad, pad);
        if (whiteIcon) b.setColorFilter(Color.WHITE);
        b.setContentDescription(name);
        b.setAlpha(enabled ? 1f : 0.35f);
        b.setClickable(enabled);
        if (enabled) {
            b.setOnClickListener(v -> {
                closeRing();
                action.run();
            });
        }
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(px, px);
        lp.leftMargin = cx - px / 2;
        lp.topMargin = cy - px / 2;
        ring.addView(b, lp);
    }

    private void closeRing() {
        MAIN.removeCallbacks(closeRing);
        if (ring == null) return;
        FrameLayout old = ring;
        ring = null;
        if (old.isAttachedToWindow()) windowManager.removeView(old);
    }

    private void ringStop() {
        if (!"writing".equals(state)) return;
        WriterActivity.stopWriting();
        setState("idle", "");
        toast("Stopped");
    }

    private void ringCopy() {
        if (proposal.isEmpty()) return;
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Bidderr proposal", proposal));
        setState("ready", proposal);
        toast("Copied. Tap the proposal box, then Paste.");
    }

    private void ringOpen() {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    private void ringHide() {
        setPaused(this, true);
        toast("Bubble hidden. Turn it on again from the Bidderr tile or app.");
    }

    private void ringSnooze() {
        long until = System.currentTimeMillis() + SNOOZE_MS;
        getSharedPreferences("bubble", MODE_PRIVATE).edit().putLong("pausedUntil", until).apply();
        MAIN.removeCallbacks(snoozeOver);
        MAIN.postDelayed(snoozeOver, SNOOZE_MS);
        updateVisibility();
        toast("Bubble hidden for 30 minutes");
    }

    private void ringReset() {
        resetPosition();
    }

    // idle | writing | ready
    private void setState(String newState, String text) {
        if (bubble == null) return;
        state = newState;
        if ("ready".equals(newState)) proposal = text == null ? "" : text;
        MAIN.removeCallbacks(backToIdle);
        if (pulse != null) {
            pulse.cancel();
            bubble.setAlpha(1f);
        }

        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[] {Color.rgb(52, 211, 153), Color.rgb(16, 185, 129), Color.rgb(15, 118, 110)});
        bg.setStroke((int) (2 * dp), Color.WHITE);

        if ("ready".equals(newState)) {
            bg.setCornerRadius(28 * dp); // pill
            label.setText("Paste");
            label.setVisibility(View.VISIBLE);
            bubble.setContentDescription("Paste the proposal into the selected box");
            MAIN.postDelayed(backToIdle, READY_TIMEOUT_MS);
        } else {
            bg.setShape(GradientDrawable.OVAL);
            label.setVisibility(View.GONE);
            bubble.setContentDescription("writing".equals(newState) ? "Writing proposal" : "Write proposal with Bidderr");
        }
        bubble.setBackground(bg);

        if ("writing".equals(newState)) {
            pulse = ObjectAnimator.ofFloat(bubble, "alpha", 1f, 0.45f);
            pulse.setDuration(650);
            pulse.setRepeatMode(ValueAnimator.REVERSE);
            pulse.setRepeatCount(ValueAnimator.INFINITE);
            pulse.start();
        }
        updateVisibility();
        if (bubble.isAttachedToWindow()) windowManager.updateViewLayout(bubble, params);
    }

    // The B only shows in job apps; while writing or ready to paste it shows everywhere.
    // Paused (from the Quick Settings tile): never shows.
    private void updateVisibility() {
        if (bubble == null) return;
        boolean show = !isPaused(this) && (!"idle".equals(state) || inJobApp);
        bubble.setVisibility(show ? View.VISIBLE : View.GONE);
        if (!show) closeRing();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (bubble == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkgSeq = event.getPackageName();
        if (pkgSeq == null) return;
        String pkg = pkgSeq.toString().toLowerCase();
        // Ignore pop-ups that sit on top of the app (keyboard, notification shade, Bidderr itself).
        if (pkg.equals(getPackageName()) || pkg.contains("systemui") || pkg.contains("inputmethod")
                || pkg.contains("keyboard")) return;
        inJobApp = isJobApp(pkg);
        updateVisibility();
    }

    private static boolean isJobApp(String pkg) {
        return pkg.contains("upwork") || pkg.contains("peopleperhour") || pkg.contains("fiverr")
                || pkg.contains("freelancer") || pkg.contains("chrome") || pkg.contains("browser")
                || pkg.contains("firefox") || pkg.contains("mozilla") || pkg.contains("opera")
                || pkg.contains("brave") || pkg.contains("emmx") || pkg.contains("sbrowser")
                || pkg.contains("duckduckgo") || pkg.contains("vivaldi");
    }

    private void onBubbleTapped() {
        if ("ready".equals(state)) {
            pasteIntoFocusedBox();
        } else if ("idle".equals(state)) {
            String text = readScreenText();
            if (text.trim().length() < 30) {
                toast("Bidderr: no job text found on this screen");
                return;
            }
            setState("writing", "");
            startActivity(new Intent(this, WriterActivity.class)
                    .setAction(MainActivity.ACTION_FROM_BUBBLE)
                    .putExtra(Intent.EXTRA_TEXT, text)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }

    // Pastes into the box that has the keyboard focus (the user tapped it first).
    private void pasteIntoFocusedBox() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        AccessibilityNodeInfo box = root == null ? null : root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (box == null || !box.isEditable()) {
            toast("Tap the proposal box first, then tap Paste");
            return;
        }
        boolean ok = box.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        CharSequence current = box.getText();
        if (!ok && !proposal.isEmpty() && (current == null || current.length() == 0)) {
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, proposal);
            ok = box.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        }
        if (ok) {
            toast("Pasted. Good luck with the job!");
            setState("idle", "");
        } else {
            toast("Could not paste here. Long-press the box and tap Paste.");
        }
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    // Collects all text in the app under the bubble, top to bottom.
    private String readScreenText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return "";
        StringBuilder out = new StringBuilder();
        String last = "";
        ArrayDeque<AccessibilityNodeInfo> stack = new ArrayDeque<>();
        stack.push(root);
        int seen = 0;
        while (!stack.isEmpty() && seen < MAX_NODES && out.length() < MAX_CHARS) {
            AccessibilityNodeInfo node = stack.pop();
            seen++;
            CharSequence t = node.getText();
            if (t == null || t.length() == 0) t = node.getContentDescription();
            if (t != null) {
                String s = t.toString().trim();
                if (!s.isEmpty() && !s.equals(last)) {
                    out.append(s).append('\n');
                    last = s;
                }
            }
            // Push children in reverse so they come out in reading order.
            for (int i = node.getChildCount() - 1; i >= 0; i--) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) stack.push(child);
            }
        }
        return out.toString();
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        instance = null;
        MAIN.removeCallbacks(backToIdle);
        MAIN.removeCallbacks(snoozeOver);
        closeRing();
        if (pulse != null) pulse.cancel();
        if (bubble != null && windowManager != null) windowManager.removeView(bubble);
        bubble = null;
        super.onDestroy();
    }
}
