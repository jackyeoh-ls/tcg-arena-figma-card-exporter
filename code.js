// --- CONFIGURATION ---
const CONFIG = {
  DEFAULT_SEARCH_DEPTH: 3, 
  IMG_BASE_URL: "https://jackyeoh-ls.github.io/tcg-arena-ccg/img",
  STORAGE_KEY: "card_exporter_cache"
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function toTitleCase(str) {
  return str.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

// --- HELPER: HSL to Hex ---
function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// --- HELPER: Random Unique & Bright Color ---
function getDistinctBrightColor(usedHues) {
  let h;
  let attempts = 0;
  let isDistict = false;

  while (!isDistict && attempts < 50) {
    h = Math.floor(Math.random() * 360);
    let tooClose = false;
    for (const existingHue of usedHues) {
      let diff = Math.abs(h - existingHue);
      if (diff > 180) diff = 360 - diff;
      if (diff < 30) { tooClose = true; break; }
    }
    if (!tooClose) isDistict = true;
    attempts++;
  }
  usedHues.push(h);
  const s = Math.floor(Math.random() * (100 - 75 + 1)) + 75; 
  const l = Math.floor(Math.random() * (85 - 60 + 1)) + 60; 
  return hslToHex(h, s, l);
}

// --- SCANNING HELPERS ---
function findNodes(node, currentDepth, maxDepth) {
  let results = [];
  if (node.name && /^(cards?|token)-(.+)$/i.test(node.name)) {
    results.push(node);
  }
  if (currentDepth < maxDepth && "children" in node) {
    for (const child of node.children) {
      results = results.concat(findNodes(child, currentDepth + 1, maxDepth));
    }
  }
  return results;
}

function getTextNodes(node) {
  let texts = [];
  if (node.type === "TEXT") texts.push(node);
  if ("children" in node) {
    for (const child of node.children) texts = texts.concat(getTextNodes(child));
  }
  return texts;
}

// --- HELPER: Detect Bold Segments & Clean Up ---
function getBoldedPhrases(node) {
  if (!node.getStyledTextSegments) return [];
  const segments = node.getStyledTextSegments(['fontName']);
  const bolds = [];
  
  for (const seg of segments) {
    const style = seg.fontName.style.toLowerCase();
    const isBold = style.includes('bold') || style.includes('heavy') || style.includes('black');
    
    if (isBold) {
      // 1. Split by newline (handle chained keywords)
      const parts = seg.characters.split('\n');
      
      for (let part of parts) {
        // 2. Remove special chars: ->, ., :, and the Unicode Arrow (→)
        let clean = part.replace(/[->.:→]/g, "").trim();
        
        // 3. Title Case
        clean = toTitleCase(clean);

        // 4. Validate (must be more than just symbols)
        if (clean.length > 1 || /[a-zA-Z0-9]/.test(clean)) {
          bolds.push(clean);
        }
      }
    }
  }
  return bolds;
}

// --- PARSING LOGIC ---
async function parseCard(cardNode, assignedId) {
  const extracted = {
    name: "Unknown", 
    type: "", 
    types: [], 
    keywords: [], 
    cost: 0, 
    damage: 0, 
    block: 0, 
    text: "", 
    head: false, body: false, leg: false
  };

  const textLayers = getTextNodes(cardNode);

  for (const layer of textLayers) {
    const rawContent = layer.characters || "";
    // Create a flattened version for Regex (Stats), but keep rawContent for Text/Keywords
    const flatContent = rawContent.replace(/[\r\n]+/g, " ").trim();
    
    if (!flatContent) continue;

    // 1. Cost
    const costMatch = flatContent.match(/^(\d+)\s*ap$/i);
    if (costMatch) { extracted.cost = parseInt(costMatch[1], 10); continue; }

    // 2. Damage
    const dmgMatch = flatContent.match(/^(\d+|-)\s*dmg$/i);
    if (dmgMatch) { extracted.damage = dmgMatch[1] === "-" ? 0 : parseInt(dmgMatch[1], 10); continue; }

    // 3. Block/Dodge
    if (/block|dodge/i.test(flatContent)) {
      let val = 0;
      let foundMatch = false;
      const isDodge = /dodge/i.test(flatContent);
      const matchA = flatContent.match(/(?:block|dodge)\s*(?:all|head|body|leg)?\s*(\d+)/i);
      const matchB = flatContent.match(/(\d+)%\s*(?:block|dodge)/i);

      if (matchA) { val = parseInt(matchA[1], 10); foundMatch = true; } 
      else if (matchB) { val = parseInt(matchB[1], 10); foundMatch = true; }

      if (foundMatch) { extracted.block = isDodge ? -1 * val : val; continue; }
    }

    // 4. Type & Description (Main Text)
    const typeTextMatch = flatContent.match(/^\(([^)]+)\)\s*(.*)/);
    if (typeTextMatch) {
      const rawTypeStr = typeTextMatch[1];
      extracted.types = rawTypeStr.split(',').map(t => toTitleCase(t.trim()));
      extracted.type = extracted.types[0] || "";
      
      // PRESERVE NEWLINES: Extract description from rawContent, not flatContent
      const typeEndIndex = rawContent.indexOf(')');
      if (typeEndIndex !== -1) {
        extracted.text = rawContent.substring(typeEndIndex + 1).trim();
      } else {
        extracted.text = typeTextMatch[2]; // Fallback
      }

      // ** DETECT KEYWORDS (BOLD) **
      const rawBolds = getBoldedPhrases(layer);
      
      // Filter: exclude the Type itself if bolded
      extracted.keywords = rawBolds.filter(b => {
         const cleanB = b.replace(/[()]/g, '').trim().toLowerCase();
         return !extracted.types.some(t => t.toLowerCase() === cleanB);
      });
      continue;
    }

    // 5. Zones
    const words = flatContent.split(/\s+/);
    const validZones = ["head", "body", "leg"];
    if (words.every(w => validZones.includes(w.toLowerCase())) && words.length > 0) {
      if (/Head/i.test(flatContent)) extracted.head = true;
      if (/Body/i.test(flatContent)) extracted.body = true;
      if (/Leg/i.test(flatContent)) extracted.leg = true;
      continue;
    }

    // 6. Name (Fallback)
    if (!flatContent.match(/^\d+$/)) { extracted.name = toTitleCase(flatContent); }
  }

  const imgName = `card-${assignedId}.png`;

  return {
    data: {
      id: String(assignedId),
      isToken: false,
      face: {
        front: {
          name: "Front", type: extracted.type, cost: extracted.cost,
          image: `${CONFIG.IMG_BASE_URL}/${imgName}`,
          isHorizontal: false
        },
        back: {
          name: "Back", type: "", cost: extracted.cost,
          image: `${CONFIG.IMG_BASE_URL}/cardback.png`,
          isHorizontal: false
        }
      },
      name: extracted.name,
      type: extracted.type,
      types: extracted.types,
      keywords: extracted.keywords, // Cleaned & TitleCased
      cost: extracted.cost,
      DMG: extracted.damage,
      Block: extracted.block,
      Text: extracted.text, // Preserves newlines
      "AttackHead?": extracted.head,
      "AttackBody?": extracted.body,
      "AttackLeg?": extracted.leg
    },
    filename: imgName
  };
}

function parseToken(tokenNode) {
  const match = tokenNode.name.match(/^token-(.+)$/);
  const rawSuffix = match ? match[1] : "unknown";
  const displayName = toTitleCase(rawSuffix.replace(/-/g, ' ')); 
  const imgName = `token-${rawSuffix}.png`;

  return {
    data: {
      id: `t-${rawSuffix}`,
      isToken: true,
      face: {
        front: {
          name: "", type: "false", cost: 0,
          image: `${CONFIG.IMG_BASE_URL}/${imgName}`,
          isHorizontal: false
        }
      },
      name: `Token: ${displayName}`,
      type: "false", cost: 0,
      keywords: [],
      "AttackHead?": false, "AttackBody?": false, "AttackLeg?": false,
      Text: "", Block: 0, DMG: 0
    },
    filename: imgName
  };
}

function getIdentifiedCards(allCandidates) {
  let numberedCards = [];
  let pendingCards = [];
  let tokenNodes = [];
  let maxId = 0;

  for (const node of allCandidates) {
    const name = node.name;
    
    if (name.startsWith("token-")) {
      tokenNodes.push(node);
    } 
    else if (/^card-(\d+)$/.test(name)) {
      const match = name.match(/^card-(\d+)$/);
      const idx = parseInt(match[1], 10);
      if (idx > maxId) maxId = idx;
      numberedCards.push({ node, sortIndex: idx });
    } 
    else if (/^cards?-[?x]+$/.test(name)) {
      pendingCards.push(node);
    }
  }

  let nextId = maxId + 1;
  for (const node of pendingCards) {
    const newName = `card-${nextId}`;
    try {
      node.name = newName; 
      numberedCards.push({ node, sortIndex: nextId });
      nextId++;
    } catch (err) { console.error("Renaming failed", err); }
  }

  numberedCards.sort((a, b) => a.sortIndex - b.sortIndex);
  tokenNodes.sort((a, b) => a.name.localeCompare(b.name));

  return { numberedCards, tokenNodes };
}


// --- MAIN CONTROLLER ---
async function run() {
  figma.showUI(__html__, { width: 500, height: 600 });

  const pages = figma.root.children
    .filter(node => node.type === 'PAGE')
    .map(p => ({ id: p.id, name: p.name, current: p.id === figma.currentPage.id }));

  let storedCache = null;
  try {
    storedCache = await figma.clientStorage.getAsync(CONFIG.STORAGE_KEY);
  } catch (e) { console.log("No cache"); }

  figma.ui.postMessage({ 
    type: 'init-state', 
    pages: pages,
    lastScanDate: storedCache ? storedCache.timestamp : null,
    lastScanCount: storedCache ? Object.keys(storedCache.json).length : 0,
    lastJson: storedCache ? JSON.stringify(storedCache.json, null, 2) : ""
  });

  figma.ui.onmessage = async (msg) => {
    
    // === 1. EXPORT JSON/IMAGES ===
    if (msg.type === 'run-scan') {
      let pageNode;
      try { pageNode = await figma.getNodeByIdAsync(msg.pageId); } catch (e) {}

      if (!pageNode) {
        figma.ui.postMessage({ type: 'error', message: "Page not found" });
        return;
      }

      const scanDepth = msg.scanDepth || CONFIG.DEFAULT_SEARCH_DEPTH;
      const allCandidates = findNodes(pageNode, 0, scanDepth);
      const { numberedCards, tokenNodes } = getIdentifiedCards(allCandidates);
      
      if (numberedCards.length > 0) await delay(100);

      const finalMap = {};
      const totalItems = numberedCards.length + tokenNodes.length;
      let processedCount = 0;

      const processNode = async (node, id, parserFunc) => {
        const result = await parserFunc(node, id);
        finalMap[result.data.id] = result.data;
        processedCount++;

        if (msg.exportImages) {
          let shouldExport = true;
          if (!msg.forceFull && storedCache && storedCache.json) {
            const oldData = storedCache.json[result.data.id];
            if (oldData && JSON.stringify(oldData) === JSON.stringify(result.data)) {
              shouldExport = false;
            }
          }

          if (shouldExport) {
            try {
              await delay(20);
              const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
              figma.ui.postMessage({ type: 'image-chunk', filename: result.filename, data: bytes, current: processedCount, total: totalItems });
            } catch (err) { console.error("Export fail", err); }
          } else {
             figma.ui.postMessage({ type: 'image-chunk', filename: null, data: null, current: processedCount, total: totalItems });
          }
        }
      };

      for (const item of numberedCards) { await processNode(item.node, item.sortIndex, parseCard); }
      for (const node of tokenNodes) { await processNode(node, null, parseToken); }

      const newCache = { timestamp: Date.now(), json: finalMap };
      storedCache = newCache; 
      await figma.clientStorage.setAsync(CONFIG.STORAGE_KEY, newCache);

      figma.ui.postMessage({ type: 'complete', json: JSON.stringify(finalMap, null, 2), count: Object.keys(finalMap).length });
    }

    // === 2. EXTRACT FRAMES ===
    else if (msg.type === 'run-extract') {
      try {
        const sourcePage = await figma.getNodeByIdAsync(msg.sourceId);
        const targetPage = await figma.getNodeByIdAsync(msg.targetId);
        if (!sourcePage || !targetPage) throw new Error("Pages not found");

        const allCandidates = findNodes(sourcePage, 0, CONFIG.DEFAULT_SEARCH_DEPTH);
        const { numberedCards, tokenNodes } = getIdentifiedCards(allCandidates);
        
        await delay(100);
        targetPage.children.forEach(child => child.remove());

        let copiedCount = 0;
        const cloneAndMove = (node) => {
          const clone = node.clone();
          targetPage.appendChild(clone);
          clone.x = (copiedCount % 10) * (clone.width + 50);
          clone.y = Math.floor(copiedCount / 10) * (clone.height + 50);
          copiedCount++;
        };
        for (const item of numberedCards) cloneAndMove(item.node);
        for (const node of tokenNodes) cloneAndMove(node);

        figma.ui.postMessage({ type: 'extract-complete', count: copiedCount, targetName: targetPage.name });
      } catch (err) { figma.ui.postMessage({ type: 'error', message: err.message }); }
    }

    // === 3. MINIDECK DATA ===
    else if (msg.type === 'extract-minideck-data') {
      try {
        const pageNode = await figma.getNodeByIdAsync(msg.pageId);
        if (!pageNode) throw new Error("Page not found");

        const minidecks = [];
        const usedHues = []; 
        for (const deckFrame of pageNode.children) {
          if (deckFrame.type !== "FRAME" && deckFrame.type !== "GROUP" && deckFrame.type !== "SECTION") continue;
          if (deckFrame.name.toLowerCase().startsWith("card-")) continue;

          const uniqueColor = getDistinctBrightColor(usedHues);
          const deckObj = {
            name: deckFrame.name, description: "Generated from Figma", color: uniqueColor, cardPool: []
          };

          if (deckFrame.children) {
            for (const rarityFrame of deckFrame.children) {
              if (rarityFrame.type !== "FRAME" && rarityFrame.type !== "GROUP") continue;
              const rarityName = rarityFrame.name.toLowerCase();
              if (rarityName === "generated") continue;

              if (rarityFrame.children) {
                for (const cardNode of rarityFrame.children) {
                   if (/^(cards?)-/.test(cardNode.name)) {
                      const parsed = await parseCard(cardNode, 0); 
                      const synergies = [];
                      synergies.push(`${parsed.data.cost} AP`);
                      if (parsed.data.types && parsed.data.types.length > 0) synergies.push(...parsed.data.types);
                      deckObj.cardPool.push({
                        name: parsed.data.name, rarity: rarityName, synergies: synergies
                      });
                   }
                }
              }
            }
          }
          minidecks.push(deckObj);
        }
        figma.ui.postMessage({ type: 'minideck-data-complete', count: minidecks.length, json: JSON.stringify(minidecks, null, 2) });
      } catch (err) { figma.ui.postMessage({ type: 'error', message: err.message }); }
    }

    // === 4. STATS DATA ===
    else if (msg.type === 'get-stats-data') {
      try {
        const pageNode = await figma.getNodeByIdAsync(msg.pageId);
        if (!pageNode) throw new Error("Page not found");

        const allCandidates = findNodes(pageNode, 0, CONFIG.DEFAULT_SEARCH_DEPTH);
        const { numberedCards } = getIdentifiedCards(allCandidates);
        
        const statsData = [];
        for (const item of numberedCards) {
          const result = await parseCard(item.node, item.sortIndex);
          if (result && result.data) statsData.push(result.data);
        }
        figma.ui.postMessage({ type: 'stats-data', data: statsData });
      } catch (err) { figma.ui.postMessage({ type: 'error', message: err.message }); }
    }
  };
}
run();