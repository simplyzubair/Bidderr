package com.bidderr.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * "Bidderr bubble" tile in the Quick Settings panel: tap to hide or show the floating B.
 * If the bubble is not turned on in Accessibility yet, the tap opens those settings.
 */
public class BubbleTileService extends TileService {
    @Override
    public void onStartListening() {
        super.onStartListening();
        refresh();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (!BubbleService.isRunning()) {
            openAccessibilitySettings();
            return;
        }
        BubbleService.setPaused(this, !BubbleService.isPaused(this));
        refresh();
    }

    private void refresh() {
        Tile tile = getQsTile();
        if (tile == null) return;
        boolean running = BubbleService.isRunning();
        boolean on = running && !BubbleService.isPaused(this);
        tile.setState(on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        tile.setLabel("Bidderr bubble");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(!running ? "Set up" : on ? "On" : "Hidden");
        }
        tile.updateTile();
    }

    @SuppressWarnings("deprecation")
    private void openAccessibilitySettings() {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE));
        } else {
            startActivityAndCollapse(intent);
        }
    }
}
