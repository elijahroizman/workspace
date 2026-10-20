#!/bin/sh
# Installed by Workspace (Settings › General › Command line). Reinstall it there after moving the app.
#
# workspace [file or folder]...
#   Opens files in tabs and a folder in the sidebar, in the running Workspace (or starts it).
#   A Markdown, text or LaTeX file that doesn't exist yet is created empty first.

BUNDLE_ID='@BUNDLE_ID@'
VERSION='@VERSION@'

usage() {
  cat <<USAGE
Usage: workspace [options] [file or folder]...

Opens files in Workspace tabs and a folder in its sidebar.
With no arguments, brings Workspace to the front.

  workspace .             open this folder
  workspace notes.md      open (or create) a file
  workspace a.pdf b.docx  open several files

Options:
  -h, --help     show this help
  -v, --version  show the version
USAGE
}

status=0
options=1
for arg do
  shift
  [ $options -eq 1 ] && case "$arg" in
    -h | --help)
      usage
      exit 0
      ;;
    -v | --version)
      echo "Workspace $VERSION"
      exit 0
      ;;
    --)
      options=0
      continue
      ;;
    -*)
      echo "workspace: unknown option $arg (see workspace --help)" >&2
      exit 2
      ;;
  esac
  if [ ! -e "$arg" ]; then
    case "$arg" in
      *.md | *.markdown | *.txt | *.tex)
        if ! : > "$arg"; then
          status=1
          continue
        fi
        ;;
      *)
        echo "workspace: $arg: no such file or folder" >&2
        status=1
        continue
        ;;
    esac
  fi
  # A leading dash would read as an option to open.
  case "$arg" in
    -*) arg="./$arg" ;;
  esac
  set -- "$@" "$arg"
done

if [ $# -eq 0 ] && [ $status -ne 0 ]; then
  exit $status
fi
open -b "$BUNDLE_ID" "$@" || exit 1
exit $status
