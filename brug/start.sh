#!/data/data/com.termux/files/usr/bin/sh
# Zet het programmaatje aan op de achtergrond en houdt het aan, ook na een
# fout. Voor Termux op een Android-telefoon: met de hand (sh start.sh), of na
# een herstart van de telefoon vanzelf, via Termux:Boot (node brug.mjs termux-boot).
#
#   Meekijken:  tail -f ~/thuis-energie/brug/brug.log
#   Bijwerken:  sh ~/thuis-energie/brug/bijwerken.sh
#   Stoppen:    node ~/thuis-energie/brug/brug.mjs stop
#   Waakhond:   waakhond.sh (elk kwartier via termux-job-scheduler, zie de LEESMIJ)
cd "$(dirname "$0")" || exit 1
if node brug.mjs status > /dev/null 2>&1; then
  echo "Het programmaatje draait al. Opnieuw starten: node brug.mjs herstart"
  exit 0
fi
command -v termux-wake-lock > /dev/null && termux-wake-lock
rm -f gestopt
nohup sh -c '
  while [ ! -e gestopt ]; do
    # Het logboek blijft klein: boven 1 MB gaat het oude opzij.
    if [ -f brug.log ] && [ "$(wc -c < brug.log)" -gt 1000000 ]; then mv brug.log brug.log.1; fi
    node brug.mjs >> brug.log 2>&1
    uitkomst=$?
    # 3: er draait er al een. Gestopt met node brug.mjs stop: niet opnieuw.
    if [ "$uitkomst" -eq 3 ] || [ -e gestopt ]; then break; fi
    # Netjes gestopt (herstart): meteen weer aan. Een fout: even wachten.
    if [ "$uitkomst" -eq 0 ]; then sleep 2; else sleep 30; fi
  done
' > /dev/null 2>&1 &
echo "Het programmaatje draait nu op de achtergrond."
echo "Meekijken: tail -f ~/thuis-energie/brug/brug.log (stoppen met kijken: CTRL en dan c)"
