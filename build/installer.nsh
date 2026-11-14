; Extra steps for the Bidderr installer / uninstaller (electron-builder includes this file).

; Closing the app politely lets it install a downloaded update on its way out, which put
; Bidderr back right after an uninstall. So: drop the waiting update, then stop the app hard.
!macro customCheckAppRunning
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\bidderr-updater"
  ${endIf}
  nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
  Sleep 1000
!macroend

; A real uninstall (not an update) also removes "start with Windows".
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.bidderr.app"
    ; The uninstaller sits in the install folder, which kept the empty folder behind.
    SetOutPath "$TEMP"
    RMDir "$INSTDIR"
  ${endIf}
!macroend
