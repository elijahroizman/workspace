; The Windows installer and uninstaller both stop if they cannot close Workspace.
; Tauri's template asks Restart Manager to shut down whatever has
; $INSTDIR\Workspace.exe open, and aborts when that call fails:
; "Failed to kill Workspace. Please close it first then try again".
;
; An update starts this installer and then exits the running app with
; process::exit. Restart Manager cannot shut down a process that is already
; exiting, so the update aborts. The same check aborts an uninstall while
; Workspace is open. See tauri-apps/tauri#16277 and #12309.
;
; Wait until that file is free. If it is still in use, end the process that
; has it open and wait again. A normal install, with Workspace open and no
; update in progress, still asks before closing it.

!macro StopInstalledWorkspace
  ; The path is passed through the environment so a quote or space in the
  ; user name cannot break the PowerShell command.
  System::Call 'kernel32::SetEnvironmentVariable(t "WORKSPACE_INSTALL_EXE", t "$INSTDIR\${MAINBINARYNAME}.exe")'
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq $$env:WORKSPACE_INSTALL_EXE } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $1
  System::Call 'kernel32::SetEnvironmentVariable(t "WORKSPACE_INSTALL_EXE", p0)'
!macroend

; mode "grace": an update. Give the app a moment to finish exiting, then end it.
; mode "now": an uninstall. End it on the first check.
!macro CloseInstalledWorkspace unique mode message
  Push $0
  Push $1
  Push $2
  Push $3
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R9 0
  StrCpy $R7 0
  ws_wait_${unique}:
    StrCpy $0 0
    !insertmacro RestartManager_StartSession $R8
    ${If} $R8 == ""
      ${If} $R7 = 0
        DetailPrint "${message}"
        StrCpy $R7 1
        !insertmacro StopInstalledWorkspace
      ${EndIf}
      Goto ws_done_${unique}
    ${EndIf}
    !insertmacro RestartManager_RegisterFile $R8 "$INSTDIR\${MAINBINARYNAME}.exe"
    ${If} $0 = 0
      ; ERROR_MORE_DATA means some process still has the installed exe open.
      System::Call 'RSTRTMGR::RmGetList(p R8, *i .r1, *i .r2, p 0, *i .r3) i .r0'
    ${EndIf}
    !insertmacro RestartManager_EndSession $R8
    ${If} $0 != ${ERROR_MORE_DATA}
      Goto ws_done_${unique}
    ${EndIf}
    ${If} $R9 >= 80
      Goto ws_done_${unique}
    ${EndIf}
    ${If} $R9 = 0
      DetailPrint "${message}"
    ${EndIf}
    IntOp $0 $R9 % 8
    ${If} $0 = 0
      !if "${mode}" == "grace"
        ${If} $R9 > 0
          !insertmacro StopInstalledWorkspace
        ${EndIf}
      !else
        !insertmacro StopInstalledWorkspace
      !endif
    ${EndIf}
    Sleep 250
    IntOp $R9 $R9 + 1
    Goto ws_wait_${unique}
  ws_done_${unique}:
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Passive and silent installs have no "close it?" question. The updater
  ; passes /P and /UPDATE. A manual install still asks.
  ${If} $UpdateMode = 1
  ${OrIf} $PassiveMode = 1
  ${OrIf} ${Silent}
    !insertmacro CloseInstalledWorkspace "inst" "grace" "Waiting for Workspace to close..."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CloseInstalledWorkspace "uninst" "now" "Closing Workspace..."
!macroend
