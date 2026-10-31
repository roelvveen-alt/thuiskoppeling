#!/data/data/com.termux/files/usr/bin/sh
# Het programmaatje veilig bijwerken, met één opdracht (telefoon én Chromebook):
#
#   sh ~/thuis-energie/brug/bijwerken.sh
#
# Wat hij doet: de nieuwe versie ophalen, maar alleen tot een nagekeken stand
# (brug/goedgekeurd.txt, of anders de nieuwste tag uitrol/…; zonder die twee de
# nieuwste van de tak), alleen vooruit (git merge --ff-only: er gaat hier nooit
# iets verloren), elk bestand nakijken (node --check, en of alles laadt met
# deze instellingen: node brug.mjs nakijken), de pakketten bijwerken als die
# echt veranderden (npm ci), opnieuw starten, en kijken of de eerste stand in
# de app komt. Start de nieuwe versie niet, of loopt hij meteen vast, dan gaat
# hij vanzelf terug naar de vorige versie.
#
# Op een Chromebook (of Raspberry Pi) houdt systemd hem aan (dienst
# thuis-energie-brug): dan start hij via systemd opnieuw, nooit start.sh
# ernaast, en kijkt hij in opstart.txt (dat het programmaatje zelf schrijft)
# in plaats van in brug.log.
#
# Bewust in sh en niet in node: een fout in een .mjs mag het bijwerken (en het
# teruggaan) niet breken. Alles staat in hoofd(), zodat sh het hele script
# gelezen heeft voordat git het bestand misschien vervangt. Veranderde dit
# script zelf, dan gaat de nieuwe versie ervan verder (--verder).

DIENST="${BRUG_DIENST:-thuis-energie-brug}"

hoofd() {
  cd "$(dirname "$0")" || exit 1
  wacht="${BRUG_WACHT:-90}"
  stap="${BRUG_STAP:-5}"
  if [ "$1" = "--verder" ] && [ -n "$BRUG_VORIGE" ]; then
    # De vorige versie van dit script haalde al op; wij kijken na en starten.
    vorige="$BRUG_VORIGE"
  else
    vorige=$(git rev-parse HEAD 2> /dev/null) || {
      echo "Dit is geen map van git; zo kan ik niet bijwerken."
      exit 1
    }
    ophalen
    script_voor=$(git rev-parse "$vorige:./bijwerken.sh" 2> /dev/null)
    if [ "$(git rev-parse "HEAD:./bijwerken.sh" 2> /dev/null)" != "$script_voor" ] && [ -f bijwerken.sh ]; then
      BRUG_VORIGE="$vorige" exec sh ./bijwerken.sh --verder
    fi
  fi
  nieuw=$(git rev-parse HEAD)
  echo "Bijgewerkt van $(kort "$vorige") naar $(kort "$nieuw"). Nakijken…"

  for bestand in *.mjs; do
    node --check "$bestand" > /dev/null 2>&1 || terug "In $bestand zit een fout."
  done
  if [ "$(pakketten "$nieuw")" != "$(pakketten "$vorige")" ] || [ ! -d node_modules ]; then
    echo "De pakketten bijwerken (npm ci)…"
    npm ci --omit=dev --silent > /dev/null 2>&1 || terug "De pakketten bijwerken lukt niet."
  fi
  # Laadt alles (ook wat node --check niet ziet, zoals een ontbrekende export), en kloppen de instellingen?
  if ! uitleg=$(node brug.mjs nakijken 2>&1); then
    reden=$(echo "$uitleg" | grep -m1 -E '^(Fout:|[A-Za-z]*Error)')
    terug "De nieuwe versie start niet: ${reden:-$(echo "$uitleg" | awk 'NF' | head -1)}"
  fi

  if onder_systemd; then
    if ! systemctl is-active --quiet "$DIENST" 2> /dev/null; then
      echo "Klaar. Het programmaatje stond uit en blijft uit. Aanzetten: sudo systemctl start $DIENST"
      exit 0
    fi
  elif [ -e gestopt ]; then
    echo "Klaar. Het programmaatje stond uit en blijft uit. Aanzetten: sh ~/thuis-energie/brug/start.sh"
    exit 0
  fi
  rm -f opstart.txt
  start_opnieuw
  echo "Even kijken of de nieuwe versie goed start (hooguit $wacht seconden)…"
  gewacht=0
  while [ "$gewacht" -lt "$wacht" ]; do
    sleep "$stap"
    gewacht=$((gewacht + stap))
    toestand=$(cut -d' ' -f1 opstart.txt 2> /dev/null)
    if [ "$toestand" = "fout" ]; then terug "De nieuwe versie liep vast (zie $(logboek))."; fi
    if [ "$toestand" = "eerste-stand" ]; then
      echo "Klaar: de nieuwe versie draait en de eerste stand staat in de app."
      exit 0
    fi
  done
  if [ "$toestand" != "gestart" ]; then terug "De nieuwe versie start niet (na $wacht seconden nog niet)."; fi
  echo "De nieuwe versie draait, maar er staat na $wacht seconden nog geen stand in de app."
  echo "Kijk mee met: $(logboek) (internet weg? sleutel?)"
  if onder_systemd; then
    echo "Terug naar de vorige versie: git -C ~/thuis-energie reset --keep $(kort "$vorige") && sudo systemctl restart $DIENST"
  else
    echo "Terug naar de vorige versie: git -C ~/thuis-energie reset --keep $(kort "$vorige") && node ~/thuis-energie/brug/brug.mjs herstart"
  fi
  exit 0
}

kort() { echo "$1" | cut -c1-7; }

# Ophalen en vooruit naar de nagekeken stand (zie kies_doel). Stopt zelf als er niets te doen is.
ophalen() {
  echo "De nieuwe versie ophalen…"
  if ! git fetch --quiet 2> /dev/null; then
    echo "Ophalen lukt niet (internet weg, of GitHub?). Er is niets veranderd."
    exit 1
  fi
  kies_doel
  if [ "$doel" = "$vorige" ] || git merge-base --is-ancestor "$doel" HEAD 2> /dev/null; then
    echo "Je hebt de nieuwste versie al${bron:+ ($bron)}."
    exit 0
  fi
  if ! git merge-base --is-ancestor HEAD "$doel" 2> /dev/null; then
    echo "Hier staat een andere versie dan op GitHub (niet alleen ouder); zo kan ik niet vooruit."
    echo "Er is niets veranderd. Laat dit zien aan wie het programmaatje bijhoudt: git log -1"
    exit 1
  fi
  if ! git merge --ff-only --quiet "$doel" > /dev/null 2>&1; then
    echo "Bijwerken kan niet zonder iets kwijt te raken: hier is iets veranderd aan de bestanden."
    echo "Er is niets veranderd. Laat dit zien aan wie het programmaatje bijhoudt: git status"
    exit 1
  fi
}

# Naar welke stand: de commit in goedgekeurd.txt (op de tak), of de nieuwste tag uitrol/…
# (wat het verst is, als ze op één lijn liggen); zonder die twee de nieuwste van de tak.
kies_doel() {
  doel=""
  bron=""
  boven=$(git rev-parse '@{u}' 2> /dev/null) || {
    echo "Deze map volgt geen tak op GitHub; zo kan ik niet bijwerken."
    exit 1
  }
  g=$(git show "$boven:./goedgekeurd.txt" 2> /dev/null | grep -E '^[0-9a-f]{7,40}$' | head -1)
  if [ -n "$g" ] && g=$(git rev-parse -q --verify "$g^{commit}" 2> /dev/null) && git merge-base --is-ancestor "$g" "$boven" 2> /dev/null; then
    doel="$g"
    bron="goedgekeurd"
  fi
  t=$(git tag -l 'uitrol/*' --merged "$boven" --sort=-creatordate 2> /dev/null | head -1)
  if [ -n "$t" ] && tc=$(git rev-parse -q --verify "$t^{commit}" 2> /dev/null); then
    if [ -z "$doel" ] || { [ "$tc" != "$doel" ] && git merge-base --is-ancestor "$doel" "$tc" 2> /dev/null; }; then
      doel="$tc"
      bron="$t"
    fi
  fi
  if [ -z "$doel" ]; then
    doel="$boven"
    bron=""
  else
    [ "$doel" != "$boven" ] && echo "Alleen tot de nagekeken versie ($bron, $(kort "$doel")); wat daarna kwam, is nog niet nagekeken."
  fi
}

# De pakketten uit package-lock.json van een versie, zonder het eigen versienummer (dat verandert elke keer).
pakketten() {
  git show "$1:./package-lock.json" 2> /dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const j = JSON.parse(s);
        delete j.version;
        if (j.packages && j.packages[""]) delete j.packages[""].version;
        process.stdout.write(require("node:crypto").createHash("sha256").update(JSON.stringify(j)).digest("hex"));
      } catch {
        process.stdout.write(s ? "?" : "geen");
      }
    });' 2> /dev/null
}

# Houdt systemd hem aan (Chromebook, Raspberry Pi)? Op een telefoon (Termux) is er geen systemctl.
onder_systemd() {
  command -v systemctl > /dev/null 2>&1 && systemctl cat "$DIENST" > /dev/null 2>&1
}

logboek() {
  if onder_systemd; then echo "journalctl -u $DIENST -f"; else echo "tail -f ~/thuis-energie/brug/brug.log"; fi
}

# Opnieuw starten. Onder systemd via systemd (nooit start.sh ernaast). Anders: veranderde
# start.sh, dan helemaal opnieuw (de oude lus staat nog in het geheugen).
start_opnieuw() {
  herstart_gedaan=1
  if onder_systemd; then
    # Zonder wachtwoord (sudo -n, zoals op een Chromebook); anders stoppen en laat systemd hem binnen een halve minuut weer starten.
    sudo -n systemctl restart "$DIENST" > /dev/null 2>&1 || node brug.mjs herstart > /dev/null 2>&1
    return
  fi
  if node brug.mjs status > /dev/null 2>&1; then
    if [ "$(git rev-parse "HEAD:./start.sh" 2> /dev/null)" != "$(git rev-parse "$vorige:./start.sh" 2> /dev/null)" ]; then
      node brug.mjs stop > /dev/null 2>&1
      sleep 3
      sh start.sh > /dev/null 2>&1
    else
      node brug.mjs herstart > /dev/null 2>&1
    fi
  else
    sh start.sh > /dev/null 2>&1
  fi
}

# Terug naar de vorige versie, met de pakketten van toen, en opnieuw starten.
terug() {
  echo "$1 Ik ga terug naar de vorige versie."
  slot_nu=$(pakketten HEAD)
  if ! git reset --quiet --keep "$vorige" > /dev/null 2>&1; then
    echo "Teruggaan lukt niet vanzelf. Laat dit zien aan wie het programmaatje bijhoudt: git status"
    exit 1
  fi
  if [ "$slot_nu" != "$(pakketten "$vorige")" ] || [ ! -d node_modules ]; then
    npm ci --omit=dev --silent > /dev/null 2>&1 || echo "Let op: de pakketten van de vorige versie terugzetten lukte niet (npm ci). Zonder internet werkt de Zendure-cloud dan niet; probeer later: cd ~/thuis-energie/brug && npm ci --omit=dev"
  fi
  if onder_systemd; then
    # Alleen als wij hem al opnieuw startten: anders draait de vorige versie gewoon nog.
    if [ -n "$herstart_gedaan" ]; then start_opnieuw; fi
  elif [ ! -e gestopt ]; then
    start_opnieuw
  fi
  echo "Terug op de vorige versie ($(kort "$vorige")); die draait weer."
  exit 1
}

hoofd "$@"
exit
