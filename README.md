# Card Exporter Plugin (Private Tool)

This is a custom Figma plugin designed to automate our card game workflow. It extracts data, syncs designs, helps with deck construction, and provides balance analysis.

## Prerequisites
* **Figma Desktop App**: You must use the Figma Desktop App (macOS or Windows), not the browser version, to load local development plugins.
    * [Download Figma Here](https://www.figma.com/downloads/)

## Installation

1.  **Download the Tool**:
    * Click the **Code** button at the top of this page and select **Download ZIP**.
    * Unzip the file to a folder on your computer (e.g., `Documents/CardExporter`).

2.  **Load into Figma**:
    * Open the Figma Desktop App and open any design file.
    * Right-click anywhere on the canvas.
    * Go to **Plugins** > **Development** > **Import plugin from manifest...**
    * Navigate to the folder where you unzipped the files.
    * Select the `manifest.json` file and click **Open**.

## How to Use

Run the plugin by right-clicking the canvas -> **Plugins** -> **Development** -> **Card Exporter**. The plugin is divided into 4 tabs for different tasks:

### 1. JSON Exporter (Data & Images)
Use this tab to get the raw assets for the game engine.
* **Select Page**: Choose the page containing your card frames.
* **Smart Scan**: Exports data and images. It skips images that haven't changed to save time.
* **Force Full Scan**: Re-exports everything from scratch (use this if images look wrong).
* **Download ZIP**: Generates a `.zip` file containing `cards.json` and a folder of PNG images.

### 2. Sync Content (Design Management)
Use this tab to update card layouts without manually copy-pasting text.
* **Source**: The "Master" page with the correct text/data.
* **Target**: The "Layout" page you want to update.
* *Note: Cards are matched by their layer name (e.g., `card-1`). It updates text and numbers but preserves the target's position.*

### 3. Minideck Data (Deck Building)
Use this tab to export minideck configurations from Figma. These should then be uploaded to the tcg arena repo for the minideck simulator to read.
* **Structure**: The plugin looks for specific Frame nesting: `Deck Name` -> `Rarity Group` -> `Card Instances`.
* **Output**: Generates a JSON list of decks, including card names and their synergies/costs.
* **Usage**: Copy the JSON output to use in the game's deck loader or for documentation.

### 4. Stats & Analysis (Balancing)
Use this tab to check the game balance of a specific page.
* **Analyze**: Scans the page and calculates metrics like Average Cost, Average Damage, and Damage-per-AP.
* **Filters**: 
    * **Type**: Filter by card type (Attack, Tactics, etc.).
    * **Cost**: Filter by AP cost.
    * **Keyword**: Filter by specific mechanics (e.g., see stats only for cards with "Tempo").
* **Tallies**: Shows a breakdown of how many cards use specific keywords, body parts, or costs.

## Troubleshooting
* **"Page not found"**: Make sure you selected the correct page in the dropdown menu.
* **Plugin doesn't update**: If you downloaded a new version, you don't need to re-import the manifest. Just run the plugin again.