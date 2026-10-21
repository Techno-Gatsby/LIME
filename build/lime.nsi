Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!define APP "Lime"
!define EXE "Lime.exe"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lime"
!define KEY "Software\Classes"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Lime"
InstallDirRegKey HKCU "${UNINST}" "InstallLocation"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AGPL-3.0-or-later"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Lime"
!define MUI_WELCOMEPAGE_TEXT "Drop any file on the Lime wheel to convert, compress or edit it, all offline on this PC.$\r$\n$\r$\nLime installs for your account only and doesn’t need administrator rights. It adds “Convert with Lime” to the File Explorer right-click menu."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open Lime"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!macro CloseApp
  nsExec::Exec 'taskkill /IM "${EXE}" /T /F'
  Sleep 600
!macroend

!macro Verb ROOT LABEL
  WriteRegStr HKCU "${KEY}\${ROOT}\shell\Lime" "" "${LABEL}"
  WriteRegStr HKCU "${KEY}\${ROOT}\shell\Lime" "Icon" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "${KEY}\${ROOT}\shell\Lime" "MultiSelectModel" "Player"
  WriteRegStr HKCU "${KEY}\${ROOT}\shell\Lime\command" "" '"$INSTDIR\${EXE}" "%1"'
!macroend

Section "Lime"
  SectionIn RO
  !insertmacro CloseApp
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources\app"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Lime.exe"
  CreateShortCut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}"
  CreateShortCut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}"
  CreateShortCut "$SENDTO\${APP}.lnk" "$INSTDIR\${EXE}"
  !insertmacro Verb "*" "Convert with Lime"
  !insertmacro Verb "Directory" "Compress with Lime"
  WriteRegStr HKCU "${KEY}\Applications\${EXE}" "FriendlyAppName" "${APP}"
  WriteRegStr HKCU "${KEY}\Applications\${EXE}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall Lime.exe"'
  WriteRegStr HKCU "${UNINST}" "QuietUninstallString" '"$INSTDIR\Uninstall Lime.exe" /S'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST}" "EstimatedSize" ${SIZE}
  ; A silent install is Lime updating itself: open it again afterwards.
  IfSilent 0 +2
  Exec '"$INSTDIR\${EXE}"'
SectionEnd

Section "Uninstall"
  !insertmacro CloseApp
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  Delete "$SENDTO\${APP}.lnk"
  DeleteRegKey HKCU "${KEY}\*\shell\Lime"
  DeleteRegKey HKCU "${KEY}\Directory\shell\Lime"
  DeleteRegKey HKCU "${KEY}\Applications\${EXE}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Lime"
  DeleteRegKey HKCU "${UNINST}"
  RMDir /r "$INSTDIR"
SectionEnd
