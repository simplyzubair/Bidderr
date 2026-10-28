package com.bidderr.app;

import android.accessibilityservice.AccessibilityService;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.ImageView;
import android.widget.Toast;

import java.util.ArrayDeque;

/**
 * The floating green "B" bubble. It shows over browsers and job apps. When tapped it reads the
 * text on the screen (the job post) and opens Bidderr, which writes the proposal, copies it and
 * goes back to the job page by itself.
 */
public class BubbleService extends AccessibilityService {
    private static final int MAX_NODES = 4000;
    private static final int MAX_CHARS = 15000;

    private WindowManager windowManager;
    private ImageView bubble;
    private WindowManager.LayoutParams params;

    @Override
    protected void onServiceConnected() {
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        addBubble();
    }

    @SuppressLint("ClickableViewAccessibility")
    private void addBubble() {
        float dp = getResources().getDisplayMetrics().density;
        int size = (int) (56 * dp);

        // Brand gradient circle with the pen-B mark (same drawing as the app icon).
        GradientDrawable circle = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[] {Color.rgb(52, 211, 153), Color.rgb(16, 185, 129), Color.rgb(15, 118, 110)});
        circle.setShape(GradientDrawable.OVAL);
        circle.setStroke((int) (2 * dp), Color.WHITE);

        bubble = new ImageView(this);
        bubble.setImageResource(R.drawable.ic_launcher_foreground);
        bubble.setScaleType(ImageView.ScaleType.FIT_CENTER);
        bubble.setBackground(circle);
        bubble.setElevation(8 * dp);
        bubble.setContentDescription("Write proposal with Bidderr");
        bubble.setVisibility(View.GONE);

        params = new WindowManager.LayoutParams(
                size, size,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = getResources().getDisplayMetrics().widthPixels - size - (int) (8 * dp);
        params.y = getResources().getDisplayMetrics().heightPixels / 2;

        // Drag to move it, tap to write a proposal.
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

    // Show the bubble only in browsers and job apps, so it stays out of the way elsewhere.
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (bubble == null) return;
        CharSequence pkgSeq = event.getPackageName();
        if (pkgSeq == null) return;
        String pkg = pkgSeq.toString().toLowerCase();
        // Ignore pop-ups that sit on top of the app (keyboard, notification shade, Bidderr itself).
        if (pkg.equals(getPackageName()) || pkg.contains("systemui") || pkg.contains("inputmethod")
                || pkg.contains("keyboard")) return;
        bubble.setVisibility(isJobApp(pkg) ? View.VISIBLE : View.GONE);
    }

    private static boolean isJobApp(String pkg) {
        return pkg.contains("upwork") || pkg.contains("peopleperhour") || pkg.contains("fiverr")
                || pkg.contains("freelancer") || pkg.contains("chrome") || pkg.contains("browser")
                || pkg.contains("firefox") || pkg.contains("mozilla") || pkg.contains("opera")
                || pkg.contains("brave") || pkg.contains("emmx") || pkg.contains("sbrowser")
                || pkg.contains("duckduckgo") || pkg.contains("vivaldi");
    }

    private void onBubbleTapped() {
        String text = readScreenText();
        if (text.trim().length() < 30) {
            Toast.makeText(this, "Bidderr: no job text found on this screen", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(this, MainActivity.class)
                .setAction(MainActivity.ACTION_FROM_BUBBLE)
                .putExtra(Intent.EXTRA_TEXT, text)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
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
        if (bubble != null && windowManager != null) windowManager.removeView(bubble);
        bubble = null;
        super.onDestroy();
    }
}
