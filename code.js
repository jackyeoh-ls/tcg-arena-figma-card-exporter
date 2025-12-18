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

// --- SCANNING HELPERS ---
function findNodes(node, currentDepth, maxDepth) {
  let results = [];
  if (node.name && /^(cards?|token)-(.+)$/.test(node.name)) {
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

// --- PARSING LOGIC ---
async function parseCard(cardNode, assignedId) {
  const extracted = {
    name: "Unknown", type: "", cost: 0, damage: 0, block: 0, 
    text: "", head: false, body: false, leg: false
  };

  const textLayers = getTextNodes(cardNode);

  for (const layer of textLayers) {
    const rawContent = layer.characters || "";
    const content = rawContent.replace(/[\r\n]+/g, " ").trim();
    if (!content) continue;

    const costMatch = content.match(/^(\d+)\s*ap$/);
    if (costMatch) { extracted.cost = parseInt(costMatch[1], 10); continue; }

    const dmgMatch = content.match(/^(\d+|-)\s*dmg$/);
    if (dmgMatch) { extracted.damage = dmgMatch[1] === "-" ? 0 : parseInt(dmgMatch[1], 10); continue; }

    if (/block|dodge/i.test(content)) {
      let val = 0;
      let foundMatch = false;
      const isDodge = /dodge/i.test(content);
      const matchA = content.match(/(?:block|dodge)\s*(?:all|head|body|leg)?\s*(\d+)/i);
      const matchB = content.match(/(\d+)%\s*(?:block|dodge)/);

      if (matchA) { val = parseInt(matchA[1], 10); foundMatch = true; } 
      else if (matchB) { val = parseInt(matchB[1], 10); foundMatch = true; }

      if (foundMatch) { extracted.block = isDodge ? -1 * val : val; continue; }
    }

    const typeTextMatch = content.match(/^\(([^)]+)\)\s*(.*)/);
    if (typeTextMatch) {
      extracted.type = toTitleCase(typeTextMatch[1].split(/[,\s]+/)[0]);
      extracted.text = typeTextMatch[2].toLowerCase();
      continue;
    }

    const words = content.split(/\s+/);
    const validZones = ["head", "body", "leg"];
    if (words.every(w => validZones.includes(w.toLowerCase())) && words.length > 0) {
      if (/Head/i.test(content)) extracted.head = true;
      if (/Body/i.test(content)) extracted.body = true;
      if (/Leg/i.test(content)) extracted.leg = true;
      continue;
    }

    if (!content.match(/^\d+$/)) { extracted.name = toTitleCase(content); }
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
      cost: extracted.cost,
      DMG: extracted.damage,
      Block: extracted.block,
      Text: extracted.text,
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
      "AttackHead?": false, "AttackBody?": false, "AttackLeg?": false,
      Text: "", Block: 0, DMG: 0
    },
    filename: imgName
  };
}

// --- HELPER: Identify, Rename, and Sort ---
function getIdentifiedCards(allCandidates) {
  let numberedCards = [];
  let pendingCards = [];
  let tokenNodes = [];
  let maxId = 0;

  // 1. Categorize
  for (const node of allCandidates) {
    if (node.name.startsWith("token-")) {
      tokenNodes.push(node);
    } else {
      const match = node.name.match(/^card-(\d+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx > maxId) maxId = idx;
        numberedCards.push({ node, sortIndex: idx });
      } else if (/^cards?-[?x]+$/.test(node.name)) {
        pendingCards.push(node);
      }
    }
  }

  // 2. Rename Pending
  let nextId = maxId + 1;
  for (const node of pendingCards) {
    const newName = `card-${nextId}`;
    try {
      node.name = newName; // Rename in Figma
      numberedCards.push({ node, sortIndex: nextId });
      nextId++;
    } catch (err) {
      console.error("Renaming failed", err);
    }
  }

  // 3. Sort
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
  } catch (e) {
    console.log("No cache found");
  }

  figma.ui.postMessage({ 
    type: 'init-state', 
    pages: pages,
    lastScanDate: storedCache ? storedCache.timestamp : null,
    lastScanCount: storedCache ? Object.keys(storedCache.json).length : 0,
    lastJson: storedCache ? JSON.stringify(storedCache.json, null, 2) : ""
  });

  figma.ui.onmessage = async (msg) => {
    
    // === HANDLER: EXPORT JSON/IMAGES ===
    if (msg.type === 'run-scan') {
      let pageNode;
      try { pageNode = await figma.getNodeByIdAsync(msg.pageId); } catch (e) {}

      if (!pageNode) {
        figma.ui.postMessage({ type: 'error', message: "Page not found" });
        return;
      }

      const scanDepth = msg.scanDepth || CONFIG.DEFAULT_SEARCH_DEPTH;
      const allCandidates = findNodes(pageNode, 0, scanDepth);
      
      // Identify & Rename
      const { numberedCards, tokenNodes } = getIdentifiedCards(allCandidates);
      
      const finalMap = {};
      const totalItems = numberedCards.length + tokenNodes.length;
      let processedCount = 0;

      const processNode = async (node, id, parserFunc) => {
        const result = await parserFunc(node, id);
        finalMap[result.data.id] = result.data;
        processedCount++;

        if (msg.exportImages) {
          let shouldExport = true;
          // Smart Scan Logic
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

      // Process Numbered Cards
      for (const item of numberedCards) {
        await processNode(item.node, item.sortIndex, parseCard);
      }
      // Process Tokens
      for (const node of tokenNodes) {
        await processNode(node, null, parseToken);
      }

      // Save Cache
      const newCache = { timestamp: Date.now(), json: finalMap };
      storedCache = newCache; 
      await figma.clientStorage.setAsync(CONFIG.STORAGE_KEY, newCache);

      figma.ui.postMessage({ type: 'complete', json: JSON.stringify(finalMap, null, 2), count: Object.keys(finalMap).length });
    }

    // === HANDLER: EXTRACT FRAMES ===
    else if (msg.type === 'run-extract') {
      try {
        const sourcePage = await figma.getNodeByIdAsync(msg.sourceId);
        const targetPage = await figma.getNodeByIdAsync(msg.targetId);

        if (!sourcePage || !targetPage) throw new Error("Pages not found");

        // 1. Scan Source (Renaming occurs here automatically via helper)
        const allCandidates = findNodes(sourcePage, 0, CONFIG.DEFAULT_SEARCH_DEPTH);
        const { numberedCards, tokenNodes } = getIdentifiedCards(allCandidates);
        
        // 2. Clear Target
        targetPage.children.forEach(child => child.remove());

        // 3. Clone & Move
        let copiedCount = 0;
        
        // Helper to clone
        const cloneAndMove = (node) => {
          const clone = node.clone();
          targetPage.appendChild(clone);
          
          // Optional: Arrange nicely? 
          // For now, keep original positions (default clone behavior) 
          // but ensure they are visible. 
          // Since we reparent, they keep their 'x/y' relative to parent. 
          // If deep nested, x/y might be small. On Page (root), they appear at top-left.
          clone.x = node.absoluteTransform[0][2];
          clone.y = node.absoluteTransform[1][2];
          
          copiedCount++;
        };

        for (const item of numberedCards) cloneAndMove(item.node);
        for (const node of tokenNodes) cloneAndMove(node);

        figma.ui.postMessage({ 
          type: 'extract-complete', 
          count: copiedCount, 
          targetName: targetPage.name 
        });

      } catch (err) {
        figma.ui.postMessage({ type: 'error', message: err.message });
      }
    }
  };
}

run();