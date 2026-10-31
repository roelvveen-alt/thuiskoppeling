#!/data/data/com.termux/files/usr/bin/sh
# De waakhond van buiten: Android start dit elk kwartier (termux-job-scheduler,
# zie de LEESMIJ). Draait het programmaatje niet, dan zet hij het aan; draait
# het al (start.sh kijkt dat na), of is het met de hand gestopt (node brug.mjs
# stop), dan doet hij niets.
cd "$(dirname "$0")" || exit 1
[ -e gestopt ] && exit 0
exec sh start.sh > /dev/null 2>&1
