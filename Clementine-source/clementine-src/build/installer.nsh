; Explorer integration (per-user, no admin): right-click verbs and a Send To shortcut.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine" "" "Convert with Clementine"
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine" "Icon" '"$INSTDIR\Clementine.exe",0'
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine\command" "" '"$INSTDIR\Clementine.exe" --wheel "%1"'
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen" "" "Open in Clementine"
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen" "Icon" '"$INSTDIR\Clementine.exe",0'
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen\command" "" '"$INSTDIR\Clementine.exe" --open "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Clementine" "" "Compress with Clementine"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Clementine" "Icon" '"$INSTDIR\Clementine.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Clementine\command" "" '"$INSTDIR\Clementine.exe" --wheel "%1"'
  CreateShortCut "$SENDTO\Clementine.lnk" "$INSTDIR\Clementine.exe" "--wheel" "$INSTDIR\Clementine.exe" 0
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\Clementine"
  DeleteRegKey HKCU "Software\Classes\*\shell\ClementineOpen"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Clementine"
  Delete "$SENDTO\Clementine.lnk"
!macroend
