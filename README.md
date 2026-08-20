<div align="center">

# ioBroker.goodwe_we

**GoodWe WE (Wechselrichter) – lokale ioBroker Integration (UDP/8899)**  
Runtime-Datenpunkte + **Reserve-SOC (Mindest-SOC) steuerbar**

</div>

---

## Überblick

`ioBroker.goodwe_we` verbindet sich **lokal** mit einem GoodWe-Wechselrichter über **UDP Port 8899**.  
Der Adapter liest regelmäßig alle verfügbaren **Runtime-Werte** aus und legt die Datenpunkte automatisch in ioBroker an.  
Zusätzlich kann der **Reserve-SOC / Mindest-SOC** (Min-SOC) im Netzbetrieb direkt über ioBroker gesetzt werden.

---

## Funktionen

- **Lokale Verbindung** (kein Cloud-Zwang)
- **UDP only** (Port **8899**)
- **Polling** frei einstellbar (z. B. 5s / 10s / 30s)
- Automatisches Erstellen/Aktualisieren aller Datenpunkte unter `runtime.*`
- **Reserve-SOC / Mindest-SOC** über `control.minSoc` (0–100%) **schreibbar**
- **Auto-venv**: Erstellt automatisch ein Python-Virtualenv am ioBroker-Host und installiert Abhängigkeiten

---

## Voraussetzungen

### ioBroker Host (Linux)
Benötigt werden:

- `python3`
- `python3-venv`
- `python3-pip`

Installation (Debian/Ubuntu/Raspberry Pi OS):

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip
```

### ☕ Unterstütze das Büro-Kaffeekonto!

Damit der Kaffee im Büro nie ausgeht und die Entwicklung weiter auf Hochtouren läuft, freuen wir uns über eine kleine Unterstützung. ☕💻

Jeder Beitrag hilft dabei, die Kaffeemaschine am Laufen zu halten und sorgt für genügend Energie für neue Ideen, Funktionen und Updates.

[![PayPal](https://img.shields.io/badge/PayPal-Kaffee%20spendieren-0070BA?logo=paypal\&logoColor=white)](https://paypal.me/stephanflug)

**☕ [Kaffee via PayPal spendieren](https://paypal.me/stephanflug)**

Vielen Dank für deine Unterstützung! ❤️

