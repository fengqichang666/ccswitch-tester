!include FileFunc.nsh
!include LogicLib.nsh
!include nsDialogs.nsh
!insertmacro GetRoot

!ifndef BUILD_UNINSTALLER
  !macro customPageAfterChangeDir
    Var customDirectoryDialog
    Var customDirectoryInput
    Var customDirectoryBrowseButton

    Page custom customDirectoryPageCreate customDirectoryPageLeave

    Function normalizeInstallDirectory
      ${GetRoot} $0 $1
      StrLen $2 $0
      ${If} $1 != ""
      ${AndIf} $2 <= 3
        StrCpy $0 "$1\${APP_FILENAME}"
      ${EndIf}
    FunctionEnd

    Function customDirectoryBrowse
      Pop $0
      ${NSD_GetText} $customDirectoryInput $0
      nsDialogs::SelectFolderDialog "选择安装位置" "$0"
      Pop $0

      ${If} $0 != error
        Call normalizeInstallDirectory
        StrCpy $INSTDIR $0
        ${NSD_SetText} $customDirectoryInput $INSTDIR
      ${EndIf}
    FunctionEnd

    Function customDirectoryPageCreate
      ${If} ${isUpdated}
        Abort
      ${EndIf}

      !insertmacro MUI_HEADER_TEXT "选择安装位置" "选择 CCSwitch Tester 的安装文件夹。"

      nsDialogs::Create 1018
      Pop $customDirectoryDialog
      ${If} $customDirectoryDialog == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0u 8u 100% 12u "目标文件夹"
      Pop $0

      ${NSD_CreateDirRequest} 0u 24u 78% 14u "$INSTDIR"
      Pop $customDirectoryInput

      ${NSD_CreateBrowseButton} 80% 24u 20% 14u "浏览(B)..."
      Pop $customDirectoryBrowseButton
      ${NSD_OnClick} $customDirectoryBrowseButton customDirectoryBrowse

      nsDialogs::Show
    FunctionEnd

    Function customDirectoryPageLeave
      ${NSD_GetText} $customDirectoryInput $0
      ${If} $0 == ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "请选择安装目录。"
        Abort
      ${EndIf}

      Call normalizeInstallDirectory
      StrCpy $INSTDIR $0
    FunctionEnd
  !macroend
!endif
