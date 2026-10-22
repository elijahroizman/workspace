#!/bin/sh
# Installed by Writan (Settings › General › Command line). Reinstall it there after moving the app.
#
# writan [file or folder]...
#   Opens files in tabs and a folder in the sidebar, in the running Writan (or starts it).
#   A Markdown, text or LaTeX file that doesn't exist yet is created empty first.

BUNDLE_ID='@BUNDLE_ID@'
VERSION='@VERSION@'

usage() {
  cat <<USAGE
Usage: writan [options] [file or folder]...

Opens files in Writan tabs and a folder in its sidebar.
With no arguments, brings Writan to the front.

  writan .             open this folder
  writan notes.md      open (or create) a file
  writan a.pdf b.docx  open several files

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
      echo "Writan $VERSION"
      exit 0
      ;;
    --)
      options=0
      continue
      ;;
    -*)
      echo "writan: unknown option $arg (see writan --help)" >&2
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
        echo "writan: $arg: no such file or folder" >&2
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
