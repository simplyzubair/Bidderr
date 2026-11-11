package com.bidderr.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * "Write proposal" tile in the Quick Settings panel: copy a job post, swipe down, tap the tile.
 * The floating writer reads the copied job and copies the proposal. No accessibility needed,
 * so banking apps have nothing to complain about.
 */
public class WriteTileService extends TileService {
    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(Tile.STATE_INACTIVE); // a button, not an on/off switch
        tile.setLabel("Write proposal");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle("From copied job");
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (isLocked()) unlockAndRun(this::openWriter);
        else openWriter();
    }

    @SuppressWarnings("deprecation")
    private void openWriter() {
        Intent intent = new Intent(this, WriterActivity.class)
                .setAction(WriterActivity.ACTION_WRITE_COPIED)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        } else {
            startActivityAndCollapse(intent);
        }
    }
}
