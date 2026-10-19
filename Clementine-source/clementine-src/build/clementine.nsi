; Clementine installer — per-user, no admin rights. Built with makensis (no Wine needed).
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!define APP "Clementine"
!define VERSION "1.0.0"
!define EXE "Clementine.exe"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Clementine"
!ifndef SRC
  !define SRC "..\dist\win-unpacked"
!endif

Name "${APP}"
OutFile "..\dist\Clementine-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Clementine"
InstallDirRegKey HKCU "${UNINST}" "InstallLocation"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AGPL-3.0-or-later"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Clementine"
!define MUI_WELCOMEPAGE_TEXT "Convert, compress and edit PDFs, images, video, audio, documents and archives on this PC.$\r$\n$\r$\nClementine installs for your account only and doesn’t need administrator rights. It adds “Convert with Clementine” to the File Explorer right-click menu.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open Clementine"
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

Section "Clementine" SecMain
  SectionIn RO
  !insertmacro CloseApp
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources\app"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Clementine.exe"

  ; Start menu + desktop (the app adds its AppUserModelID to the Start menu shortcut on first run for notifications)
  CreateShortCut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  ; File Explorer integration
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine" "" "Convert with Clementine"
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine" "Icon" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\Clementine\command" "" '"$INSTDIR\${EXE}" --wheel "%1"'
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen" "" "Open in Clementine"
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen" "Icon" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\ClementineOpen\command" "" '"$INSTDIR\${EXE}" --open "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Clementine" "" "Compress with Clementine"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Clementine" "Icon" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Clementine\command" "" '"$INSTDIR\${EXE}" --wheel "%1"'
  CreateShortCut "$SENDTO\${APP}.lnk" "$INSTDIR\${EXE}" "--wheel" "$INSTDIR\${EXE}" 0

  ; "Open with" registration
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\shell\open\command" "" '"$INSTDIR\${EXE}" --open "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}" "FriendlyAppName" "${APP}"
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithList\${EXE}" "" ""
  WriteRegStr HKCU "Software\Classes\.heic\OpenWithList\${EXE}" "" ""
  WriteRegStr HKCU "Software\Classes\.rar\OpenWithList\${EXE}" "" ""
  WriteRegStr HKCU "Software\Classes\.7z\OpenWithList\${EXE}" "" ""

  ; Apps & features entry
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Clementine"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" '"$INSTDIR\${EXE}",0'
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall Clementine.exe"'
  WriteRegStr HKCU "${UNINST}" "QuietUninstallString" '"$INSTDIR\Uninstall Clementine.exe" /S'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST}" "EstimatedSize" 980000
SectionEnd

Section "Uninstall"
  !insertmacro CloseApp
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  Delete "$SENDTO\${APP}.lnk"
  DeleteRegKey HKCU "Software\Classes\*\shell\Clementine"
  DeleteRegKey HKCU "Software\Classes\*\shell\ClementineOpen"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Clementine"
  DeleteRegKey HKCU "Software\Classes\Applications\${EXE}"
  DeleteRegKey HKCU "Software\Classes\.pdf\OpenWithList\${EXE}"
  DeleteRegKey HKCU "Software\Classes\.heic\OpenWithList\${EXE}"
  DeleteRegKey HKCU "Software\Classes\.rar\OpenWithList\${EXE}"
  DeleteRegKey HKCU "Software\Classes\.7z\OpenWithList\${EXE}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Clementine"
  DeleteRegKey HKCU "${UNINST}"
  RMDir /r "$INSTDIR"
SectionEnd
