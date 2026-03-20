# 🏎️ GT7 Endurance Race Strategy Calculator

Een geavanceerde, snelle en nauwkeurige webapplicatie gebouwd om de optimale racestrategieën te berekenen voor endurance races in **Gran Turismo 7**. Bereken tot op de milliseconde nauwkeurig welke banden, brandstofhoeveelheden en pitstop-frequenties leiden tot de snelste eindtijd.

## ✨ Features

- **🏎️ Dynamische Stint Simulatie**: Bereken de perfecte strategieën op basis van stint-combinaties. Het algoritme kan tot wel **50 stints diep** vooruitkijken om de meest optimale paden voor 24-uurs races te vinden in slechts ~50 milliseconden!
- **⚖️ Brandstofgewicht & Snelheidsverschil**: De simulatie houdt rekening met het feit dat de auto lichter wordt naarmate de brandstof opraakt. Start je een stint met een gedeeltelijk volle tank, dan berekent de app automatisch een tijdwinst per ronde ten opzichte van je basistijden (bijv. 0,01s winst per ontbrekende liter).
- **🛞 Perfecte Combinaties Testen**: Omdat de generator zó snel is, worden werkelijk álle mogelijke pitstop- en bandencombinaties berekend. Is het sneller om 8 uur lang Softs te spamen en 20 keer extra te pitten in plaats van op Hards te rijden? Dan rekent hij moeiteloos die exacte tijdwinst voor je uit en komt die strategie bovenaan.
- **⛽ Exacte Brandstof Carry-over**: Brandstof die je niet verbruikt tijdens een stint wordt correct meegenomen naar de volgende, waardoor je pitstops korter duren en de simulatie veel nauwkeuriger is.
- **⏱️ Dynamische Pitstop-berekeningen**: Ondersteunt basistijd in de pits, bandenwissel-tijd, en variabel brandstof tanken per seconde.

## 🛠️ Technologieën

- **React.js**: Moderne en schaalbare UI.
- **Vite.js**: Razendsnelle development server en geoptimaliseerde build.
- **Tailwind CSS / Vanilla CSS**: Voor een strakke, responsieve en gebruiksvriendelijke interface.
- **Pure JavaScript Logica**: Alle strategy generation bevindt zich in `src/logic/strategy.js`, zonder afhankelijkheden van React, voor ultieme performance en makkelijke tests.

## 🚀 Aan de slag

Om dit project lokaal te draaien, volg je deze stappen:

### 1. Vereisten

Zorg ervoor dat je [Node.js](https://nodejs.org/) op je computer hebt geïnstalleerd.

### 2. Installatie

Kloon de repository en installeer de afhankelijkheden:

```bash
git clone https://github.com/Jeremy-Luyckfasseel/Race-Strategies.git
cd Race-Strategies
npm install
```

### 3. Development Server

Start de lokale ontwikkelomgeving:

```bash
npm run dev
```

Open vervolgens je browser en ga naar `http://localhost:5173` om de applicatie te bekijken.

### 4. Build voor Productie

Om een geoptimaliseerde, productie-klare applicatie te bouwen:

```bash
npm run build
```

De gegenereerde bestanden komen in de `dist` map te staan.

## 🧪 Ontwikkeling en Testen

Om het onderliggende algoritme te testen zonder de visuele UI te laden, kun je het test-script uitvoeren via Node. Dit voert een voorbeeld-berekening uit via het algoritme:

```bash
node test.js
```

Dit is enorm handig voor het debuggen van simulatieregels, banden-combinaties of wiskundige wrijving!

---

Gemaakt met passie voor de Gran Turismo 7 community. Geef gas! 🏁
