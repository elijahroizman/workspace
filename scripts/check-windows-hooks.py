#!/usr/bin/env python3
"""Compile installer and uninstaller hooks with the system NSIS, without a Windows build."""
from pathlib import Path
import subprocess
import tempfile

hooks = Path(__file__).resolve().parents[1] / "src-tauri/windows/hooks.nsh"
with tempfile.TemporaryDirectory(prefix="writan-nsis-") as directory:
    root = Path(directory)
    source = root / "hooks.nsi"
    # CheckIfAppIsRunning belongs to Tauri's template, not our hooks. Its test
    # substitute lets makensis check our hook code without Tauri's Windows DLLs.
    source.write_text(r'''
Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!include Win\RestartManager.nsh
!define ERROR_MORE_DATA 234
!define MAINBINARYNAME "writan"
!define MANUKEY "Software\eliroizman"
!macro CheckIfAppIsRunning path name
  DetailPrint "Checking ${path} (${name})"
!macroend
!macro SetLnkAppUserModelId path
  DetailPrint "App ID for ${path}"
!macroend
Var UpdateMode
Var PassiveMode
Name "Writan hook compile check"
OutFile "hooks.exe"
RequestExecutionLevel user
!include "''' + str(hooks) + r'''"
Section
  StrCpy $UpdateMode 1
  StrCpy $PassiveMode 1
  !insertmacro NSIS_HOOK_PREINSTALL
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd
Section "Uninstall"
  !insertmacro NSIS_HOOK_PREUNINSTALL
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
''')
    subprocess.run(["makensis", "-V2", str(source)], cwd=root, check=True)
print("Installer and uninstaller hooks compile.")
