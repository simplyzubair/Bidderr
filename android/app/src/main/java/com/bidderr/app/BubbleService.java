package com.bidderr.app;

import android.accessibilityservice.AccessibilityService;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
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
 */
public class BubbleService extends AccessibilityService {
    private static final int MAX_NODES = 4000;
    private static final int MAX_CHARS = 15000;
    private static final long READY_TIMEOUT_MS = 3 * 60 * 1000;

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
    private final Runnable backToIdle = () -> setState("idle", "");

    // ---------- called by WriterActivity ----------

    static boolean isRunning() {
        return instance != null;
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
        params.x = getResources().getDisplayMetrics().widthPixels - (int) (64 * dp);
        params.y = getResources().getDisplayMetrics().heightPixels / 2;

        // Drag to move it, tap to act.
        bubble.setOnTouchListener(new View.OnTouchListener() {
            private int startX, startY;
            private float touchX, touchY;
            private boolean moved;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = params.x;
                        startY = params.y;
                        touchX = e.getRawX();
                        touchY = e.getRawY();
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - touchX);
                        int dy = (int) (e.getRawY() - touchY);
                        if (Math.abs(dx) > 12 * dp || Math.abs(dy) > 12 * dp) moved = true;
                        if (moved) {
                            params.x = startX + dx;
                            params.y = startY + dy;
                            windowManager.updateViewLayout(bubble, params);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) onBubbleTapped();
                        return true;
                }
                return false;
            }
        });

        windowManager.addView(bubble, params);
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
    private void updateVisibility() {
        boolean show = !"idle".equals(state) || inJobApp;
        bubble.setVisibility(show ? View.VISIBLE : View.GONE);
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
        if (pulse != null) pulse.cancel();
        if (bubble != null && windowManager != null) windowManager.removeView(bubble);
        bubble = null;
        super.onDestroy();
    }
}
