!include "LogicLib.nsh"
!include "nsProcess.nsh"

!ifndef BUILD_UNINSTALLER
  !define MUI_DIRECTORYPAGE_TEXT_TOP "$(LumeDirectoryHelp)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW LumeShowDirectory
!endif

!macro customHeader
  LangString LumeCloseBeforeSetup 1046 "O Lume está em execução. Abra o Lume, escolha Arquivo > Sair e clique em Repetir."
  LangString LumeCloseBeforeSetup 1033 "Lume is running. Choose File > Exit in Lume, then click Retry."
  !ifndef BUILD_UNINSTALLER
    LangString LumeDirectoryHelp 1046 "Mantenha a pasta Lume preenchida abaixo ou clique em Procurar para escolher outro local. Em uma atualização, mantenha a pasta da instalação atual."
    LangString LumeDirectoryHelp 1033 "Keep the Lume folder shown below or click Browse to choose another location. When updating, keep the current installation folder."
    LangString LumeDestinationUnavailable 1046 "O Windows não permitiu gravar em:$\r$\n$INSTDIR$\r$\n$\r$\n• Para instalar sem permissão de administrador, abra o instalador novamente e use a pasta Lume do seu perfil:$\r$\n$LocalAppData\Programs\Lume$\r$\n$\r$\n• Para tentar nesse mesmo local protegido, clique com o botão direito no arquivo Lume-Setup e escolha Executar como administrador. Confirme no Windows, se tiver permissão, e selecione a pasta novamente."
    LangString LumeDestinationUnavailable 1033 "Windows did not let setup write to:$\r$\n$INSTDIR$\r$\n$\r$\n• To install without administrator privileges, reopen setup and use the Lume folder in your profile:$\r$\n$LocalAppData\Programs\Lume$\r$\n$\r$\n• To try the same protected location, right-click Lume-Setup and select Run as administrator. Approve the Windows prompt if you have permission, then select the folder again."

    Function LumeShowDirectory
      # Reuse a real installation. A stale registry entry can otherwise suggest
      # a protected location left behind by a failed first install.
      ${If} $installMode == "CurrentUser"
      ${AndIf} $perUserInstallationFolder != ""
      ${AndIf} $INSTDIR == $perUserInstallationFolder
      ${AndIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        !insertmacro GetDParameter $R0
        ${If} $R0 == ""
          StrCpy $INSTDIR "$LocalAppData\Programs\Lume"
          SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$INSTDIR"
        ${EndIf}
      ${EndIf}
    FunctionEnd
  !endif
!macroend

!macro customCheckAppRunning
  # Match the app executable. The setup file can sit next to the destination and
  # share its path prefix, so checking that prefix can detect the installer itself.
  ${If} ${isUpdated}
    Sleep 1000
  ${EndIf}

  ${Do}
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${nsProcess::Unload}
    ${If} $R0 == 603
      ${ExitDo}
    ${EndIf}
    ${If} $R0 != 0
      DetailPrint "Process check failed ($R0)."
      SetErrorLevel 2
      Quit
    ${EndIf}
    # Let the reader save progress through Arquivo > Sair.
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(LumeCloseBeforeSetup)" /SD IDCANCEL IDRETRY +3
    SetErrorLevel 2
    Quit
  ${Loop}

  !ifndef BUILD_UNINSTALLER
    # Check the final destination before uninstalling the previous version or
    # copying the new files. A fresh folder is valid if Windows can create it.
    ClearErrors
    CreateDirectory "$INSTDIR"
    IfErrors lume_destination_unavailable
    System::Call 'kernel32::GetTempFileNameW(w "$INSTDIR", w "Lum", i 0, w .r1) i.r0'
    StrCmp $0 0 lume_destination_unavailable
    Delete "$1"
    ClearErrors
    Goto lume_destination_ready
    lume_destination_unavailable:
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(LumeDestinationUnavailable)" /SD IDOK
      SetErrorLevel 3
      Quit
    lume_destination_ready:
  !endif
!macroend
