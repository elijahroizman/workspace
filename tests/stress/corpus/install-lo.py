#!/usr/bin/env python3
"""Extract Ubuntu 26.04 LibreOffice packages into $HOME, without root or postinst scripts.

Other distributions should provide SOFFICE themselves instead of running this helper.
"""
import os, subprocess
from pathlib import Path
base = Path.home() / 'stress-corpus-lo'
root = base / 'root'
debs = base / 'debs'
debs.mkdir(parents=True, exist_ok=True)
packages = '''libreoffice-core libreoffice-common libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-math
libreoffice-draw libreoffice-base-core libreoffice-uiconfig-writer libreoffice-uiconfig-calc libreoffice-uiconfig-impress
libreoffice-uiconfig-common libreoffice-style-colibre fonts-opensymbol ure uno-libs-private libuno-cppu3t64
libuno-cppuhelpergcc3-3t64 libuno-sal3t64 libuno-salhelpergcc3-3t64 libclucene-core1t64 libclucene-contribs1t64
libexttextcat-2.0-0 libexttextcat-data libmythes-1.2-0 libargon2-1 libboost-locale1.90.0 libboost-thread1.90.0
libboost-iostreams1.90.0 librdf0t64 libraptor2-0 librasqal3t64 libyajl2 libeot0 libxmlsec1-nss1 libxmlsec1-1
liblangtag1 liblangtag-common libmhash2 libabw-0.1-1 libcolamd3 libe-book-0.1-1 libepubgen-0.1-1 libetonyek-0.1-1
libmwaw-0.3-3 libodfgen-0.1-1 liborcus-0.21-0 liborcus-parser-0.21-0 librevenge-0.0-0 libwpd-0.10-10
libwpg-0.3-3 libwps-0.4-4'''.split()
subprocess.run(['apt-get', 'download', *packages], cwd=debs, check=True)
for p in debs.glob('*.deb'):
    subprocess.run(['dpkg-deb', '-x', str(p), str(root)], check=True)
program = root / 'usr/lib/libreoffice/program'
f = program / 'fundamentalrc'
f.write_text(f.read_text().replace('BRAND_BASE_DIR=file:///usr/lib/libreoffice', 'BRAND_BASE_DIR=' + program.parent.as_uri()))
# Debian's postinst normally copies this ucf-managed file. Never execute package scripts here.
config = root / 'etc/libreoffice/registry/main.xcd'
config.parent.mkdir(parents=True, exist_ok=True)
config.write_bytes((root / 'usr/lib/libreoffice/share/.registry/main.xcd').read_bytes())
for p in root.rglob('*'):
    if p.is_symlink():
        target = p.readlink()
        relocated = root / str(target).lstrip('/')
        if target.is_absolute() and relocated.exists():
            p.unlink()
            p.symlink_to(relocated)
# Library order matters: UNO locates unorc beside its loaded shared library.
print('export LD_LIBRARY_PATH=' + str(program) + ':' + str(root / 'usr/lib/x86_64-linux-gnu'))
print('export SOFFICE=' + str(program / 'soffice'))
