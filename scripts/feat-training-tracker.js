(() => {

const MODULE_ID = "feat-training";
const DEFAULT_TARGET_SESSIONS = 1280; // saat
const DEFAULT_TRAINING_NAME = "Feat Training Tracker";
const TAB_ID = "feat-training";
const CHECKPOINT_DC = 15;

// İlerleme saat cinsindendir (oturumlar farklı uzunlukta olabilir). Kategoriye göre otomatik hedef.
const FEAT_GOALS_DEFAULT = { origin: 960, fightingStyle: 1280, general: 1920 };
const LEGACY_HOURS_PER_SESSION = 4;
const FEAT_CATEGORY_LABELS = { origin: "Origin", fightingStyle: "Fighting Style", general: "General", epicBoon: "Epic Boon" };
// Ayarlardan değiştirilebilen kurallar; varsayılanlar Vaelora standartlarıdır.
function cfg(key, fallback) {
  const value = Number(game.settings.get(MODULE_ID, key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function getFeatGoals() {
  return {
    origin: cfg("goalOriginHours", FEAT_GOALS_DEFAULT.origin),
    fightingStyle: cfg("goalFightingStyleHours", FEAT_GOALS_DEFAULT.fightingStyle),
    general: cfg("goalGeneralHours", FEAT_GOALS_DEFAULT.general),
    epicBoon: cfg("goalGeneralHours", FEAT_GOALS_DEFAULT.general)
  };
}
// 0 geçerli bir değerdir (checkpoint yok / DC 0); yalnızca geçersiz değer varsayılana düşer.
function cfgAllowZero(key, fallback) {
  const value = Number(game.settings.get(MODULE_ID, key));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
function getDefaultCheckpointCount() { return Math.round(cfgAllowZero("defaultCheckpointCount", 10)); }
function getRecoveryMultiplier() { return cfg("recoveryMultiplier", 2); }
function getNaturalOneSteps() { return Math.round(cfg("naturalOneSteps", 2)); }
const ACTIVE_TABS = globalThis.FeatTrainingActiveTabs ??= new Map();
const CHECKPOINT_ROLLS = new Set();

const ABILITIES = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "dashboard", {
    name: "Feat Training Dashboard",
    label: "Open dashboard",
    hint: "Trainings and every rule are managed in the dashboard (also in the Token tools on the scene controls).",
    icon: "fas fa-graduation-cap",
    type: FeatTrainingDashboardMenu,
    restricted: true
  });
  game.settings.register(MODULE_ID, "checkpointDC", { name: "Checkpoint DC", hint: "Difficulty of the checkpoint ability check. 0 = no roll: checkpoints pass automatically.", scope: "world", config: false, type: Number, default: 15 });
  game.settings.register(MODULE_ID, "goalOriginHours", { name: "Goal: Origin feats (hours)", hint: "Automatic goal for Origin feats.", scope: "world", config: false, type: Number, default: 960 });
  game.settings.register(MODULE_ID, "goalFightingStyleHours", { name: "Goal: Fighting Style feats (hours)", hint: "Automatic goal for Fighting Style feats.", scope: "world", config: false, type: Number, default: 1280 });
  game.settings.register(MODULE_ID, "goalGeneralHours", { name: "Goal: General feats (hours)", hint: "Automatic goal for General feats.", scope: "world", config: false, type: Number, default: 1920 });
  game.settings.register(MODULE_ID, "defaultCheckpointCount", { name: "Checkpoints per training", hint: "Number of checkpoints per training. 0 = no checkpoints: training completes when the goal is reached.", scope: "world", config: false, type: Number, default: 10 });
  game.settings.register(MODULE_ID, "recoveryEnabled", { name: "Double progress after a failed checkpoint", hint: "When unchecked, a failed checkpoint only sets the training back; there is no faster catch-up.", scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "recoveryMultiplier", { name: "Recovery speed", hint: "Hours count this many times after a failed checkpoint (1 disables the bonus).", scope: "world", config: false, type: Number, default: 2 });
  game.settings.register(MODULE_ID, "naturalOneSteps", { name: "Natural 1 setback (checkpoints)", hint: "How many checkpoints a natural 1 sets the training back (1 = same as a normal failure).", scope: "world", config: false, type: Number, default: 2 });
  game.settings.register(MODULE_ID, "hoursMigrated", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "allowEpicBoon", { name: "Allow Epic Boon training", hint: "Lets the GM link Epic Boons. They use the General goal.", scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "showToPlayers", {
    name: "Show training tab to players",
    hint: "When unchecked, players don't see the training tab on their character sheets. The GM always sees it.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => {
      // Açık karakter sayfaları yeni görünürlüğe göre yeniden çizilir.
      for (const app of foundry.applications.instances.values()) {
        if (app.document?.documentName === "Actor") app.render();
      }
    }
  });
});

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | Ready.`);
  if (game.users.activeGM?.isSelf && !game.settings.get(MODULE_ID, "hoursMigrated")) await migrateToHours();
});

// Eski kayıtlar oturum cinsindendi; bir kerelik saate çevrilir (1 oturum = 4 saat).
async function migrateToHours() {
  const keys = ["sessions", "targetSessions", "clearedCheckpoint", "recoveryUntil"];
  let count = 0;
  for (const actor of game.actors) {
    const update = {};
    for (const key of keys) {
      const stored = actor.getFlag(MODULE_ID, key);
      if (stored === undefined || stored === null) continue;
      const value = Number(stored);
      if (Number.isFinite(value)) update[`flags.${MODULE_ID}.${key}`] = value * LEGACY_HOURS_PER_SESSION;
    }
    if (!Object.keys(update).length) continue;
    await actor.update(update);
    count++;
  }
  await game.settings.set(MODULE_ID, "hoursMigrated", true);
  if (count) ui.notifications.info(`Feat Training: ${count} character(s) converted from sessions to hours.`);
}

// Sekme oyunculardan gizliyken oyuncu yalnızca checkpoint zarı gerektiğinde sekmeyi görür.
function isPlayerViewLimited() {
  return !game.user.isGM && !game.settings.get(MODULE_ID, "showToPlayers");
}

function isCheckpointDue(actor) {
  if (!actor.getFlag(MODULE_ID, "featUuid")) return false;
  const sessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const targetSessions = getTargetSessions(actor);
  const checkpointCount = normalizeCheckpointCount(actor.getFlag(MODULE_ID, "checkpointCount") ?? getDefaultCheckpointCount());
  if (isTrainingComplete(actor, sessions, targetSessions, checkpointCount)) return false;
  const cleared = getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount);
  return isAtCheckpoint(sessions, targetSessions, checkpointCount, cleared);
}

Hooks.on("renderCharacterActorSheet", async (sheet, html) => {
  if (isPlayerViewLimited() && !isCheckpointDue(sheet.actor)) {
    // Zar sonrası sekme gereksiz kalır: önceki render'dan kalan düğme ve içerik temizlenir,
    // eğitim sekmesi açıksa varsayılan sekmeye dönülür.
    const root = html instanceof HTMLElement ? html : html?.[0] ?? sheet.element;
    const wasActive = root?.querySelector(".feat-training-tab.active, .feat-training-tab-button.active");
    root?.querySelectorAll(".feat-training-tab, .feat-training-tab-button").forEach(el => el.remove());
    rememberTrainingTab(sheet.actor, false);
    if (wasActive || sheet.tabGroups?.primary === TAB_ID) {
      const fallback = ["attributes", "details", "inventory"].find(id => root?.querySelector(`[data-tab="${id}"]`));
      if (fallback) sheet.changeTab(fallback, "primary", { updatePosition: false });
    }
    return;
  }
  await injectTrainingTab(sheet, html);
});

Hooks.on("renderNPCActorSheet", async (sheet, html) => {
  if (!game.user.isGM) return;
  await injectTrainingTab(sheet, html);
});

// Tamamlanan eğitimin feat'i karaktere eklenince (doğrudan ya da advancement penceresi
// bitince) eğitim sıfırlanır; sekme bir sonraki feat'e hazır olur. Ana yetenek ve
// checkpoint sayısı karakter ayarı olarak korunur.
Hooks.on("createItem", async (item, options, userId) => {
  if (userId !== game.user.id || item.type !== "feat") return;
  const actor = item.parent;
  if (!(actor instanceof Actor) || !actor.getFlag(MODULE_ID, "featUuid")) return;

  const sessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const targetSessions = getTargetSessions(actor);
  const checkpointCount = normalizeCheckpointCount(actor.getFlag(MODULE_ID, "checkpointCount") ?? getDefaultCheckpointCount());
  if (!isTrainingComplete(actor, sessions, targetSessions, checkpointCount)) return;

  const identifier = actor.getFlag(MODULE_ID, "featIdentifier");
  const name = actor.getFlag(MODULE_ID, "trainingName");
  if (!((identifier && item.system?.identifier === identifier) || item.name === name)) return;

  // Yanlış feat verildiyse dashboard'daki "Undo grant" bunu geri alabilsin diye verilen eşya hatırlanır.
  await actor.setFlag(MODULE_ID, "lastGranted", { itemId: item.id, name: item.name });
  await resetTraining(actor);
  ui.notifications.info(`${actor.name}'s training was reset. Drop a new feat on the character's row in the dashboard to start again.`);
});

async function resetTraining(actor) {
  const keys = ["sessions", "clearedCheckpoint", "recoveryUntil", "targetSessions", "trainingName",
    "featUuid", "featCategory", "featIdentifier", "featRepeatable"];
  await actor.update(Object.fromEntries(keys.map(key => [`flags.${MODULE_ID}.-=${key}`, null])));
}

function getActorKey(actor) {
  return actor?.uuid ?? actor?.id ?? actor?.name;
}

function rememberTrainingTab(actor, active) {
  const key = getActorKey(actor);
  if (!key) return;
  if (active) ACTIVE_TABS.set(key, true);
  else ACTIVE_TABS.delete(key);
}

function shouldRestoreTrainingTab(actor) {
  const key = getActorKey(actor);
  return key ? ACTIVE_TABS.get(key) === true : false;
}

async function injectTrainingTab(sheet, html) {
  const actor = sheet.actor;
  if (!actor || !["character", "npc"].includes(actor.type)) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const tabInfo = findSheetTabs(root);
  if (!tabInfo) return;

  const { nav, group, contentParent } = tabInfo;

  let button = nav.querySelector(`[data-tab="${TAB_ID}"]`);

  if (!button) {
    button = document.createElement("a");
    button.classList.add("item", "feat-training-tab-button");
    button.dataset.tab = TAB_ID;
    button.dataset.group = group;
    button.title = "Training";
    button.innerHTML = `<i class="fas fa-graduation-cap"></i>`;
    nav.appendChild(button);
  }

  let tab = contentParent.querySelector(`.feat-training-tab[data-tab="${TAB_ID}"]`);

  if (!tab) {
    tab = document.createElement("section");
    tab.classList.add("tab", "feat-training-tab");
    tab.dataset.tab = TAB_ID;
    tab.dataset.group = group;
    tab.style.display = "none";
    contentParent.appendChild(tab);
  }

  const activateTrainingTab = async () => {
    nav.querySelectorAll("[data-tab]").forEach(btn => {
      btn.classList.remove("active");
      btn.setAttribute("aria-selected", "false");
    });

    contentParent.querySelectorAll(":scope > .tab").forEach(otherTab => {
      if (otherTab === tab) return;
      otherTab.classList.remove("active");
      otherTab.style.display = "none";
    });

    button.classList.add("active");
    button.setAttribute("aria-selected", "true");

    tab.classList.add("active");
    tab.style.display = "block";

    rememberTrainingTab(actor, true);
    await renderFeatTrainingTab(sheet, actor, tab);
  };

  button.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    await activateTrainingTab();
  };

  nav.querySelectorAll(`[data-tab]:not([data-tab="${TAB_ID}"])`).forEach(otherButton => {
    if (otherButton.dataset.featTrainingCloseBound === "true") return;
    otherButton.dataset.featTrainingCloseBound = "true";

    otherButton.addEventListener("click", () => {
      rememberTrainingTab(actor, false);

      button.classList.remove("active");
      button.setAttribute("aria-selected", "false");
      tab.classList.remove("active");
      tab.style.display = "none";

      setTimeout(() => {
        const activeTabId = otherButton.dataset.tab;
        const activeTab =
          contentParent.querySelector(`:scope > .tab[data-tab="${activeTabId}"]`) ||
          contentParent.querySelector(`.tab[data-tab="${activeTabId}"]`);
        if (activeTab) activeTab.style.display = "";
      }, 0);
    });
  });

  await renderFeatTrainingTab(sheet, actor, tab);

  if (shouldRestoreTrainingTab(actor)) {
    setTimeout(() => activateTrainingTab(), 0);
  }
}

function findSheetTabs(root) {
  const knownTabs = [
    "attributes",
    "inventory",
    "features",
    "spells",
    "effects",
    "biography",
    "description",
    "details",
    "stats",
    "activities"
  ];

  const referenceButton = [...root.querySelectorAll("[data-tab]")].find(el =>
    knownTabs.includes(el.dataset.tab) &&
    (el.matches("a, button") || el.closest("nav, .tabs, .sheet-tabs, .tabs-right, .sheet-navigation"))
  );

  if (!referenceButton) return null;

  const nav = referenceButton.closest("nav, .tabs, .sheet-tabs, .tabs-right, .sheet-navigation");
  if (!nav) return null;

  const group = referenceButton.dataset.group || nav.dataset.group || "primary";
  const refTabId = referenceButton.dataset.tab;

  const referenceTab =
    root.querySelector(`.tab[data-tab="${refTabId}"][data-group="${group}"]`) ||
    root.querySelector(`.tab[data-tab="${refTabId}"]`);

  if (!referenceTab?.parentElement) return null;

  const contentParent = referenceTab.parentElement;

  return { nav, group, contentParent };
}

function normalizeCheckpointCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return getDefaultCheckpointCount();
  return Math.floor(count);
}

// Hedef eşit parçalara bölünür; her parçanın sonu bir checkpoint'tir. Son checkpoint
// hedefin kendisidir (%100): eğitim ancak onun zarı geçilince tamamlanır.
function getCheckpointSessions(targetSessions, checkpointCount) {
  const count = normalizeCheckpointCount(checkpointCount);

  return Array.from({ length: count }, (_, index) => {
    const checkpointNumber = index + 1;
    return Math.round((targetSessions / count) * checkpointNumber);
  }).filter((value, index, all) => value > 0 && value <= targetSessions && all.indexOf(value) === index);
}

function isTrainingComplete(actor, sessions, targetSessions, checkpointCount) {
  return sessions >= targetSessions
    && getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount) >= targetSessions;
}

// En yüksek geçilmiş checkpoint (oturum sayısı olarak). Flag yoksa (eski
// kayıtlar) mevcut ilerlemenin kesin olarak gerisinde kalan checkpoint'ler
// geçilmiş sayılır; tam üzerinde durulan checkpoint ise henüz geçilmemiştir.
function getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount) {
  // Checkpoint yoksa ya da DC 0 ise zar gerekmez: her şey geçilmiş sayılır. Bu yalnızca okuma içindir;
  // kalıcı yazılan değer için getStoredCleared kullanılır (DC sonradan açılırsa geçmiş bozulmasın).
  if (checkpointCount < 1 || getCheckpointDC() === 0) return targetSessions;
  return getStoredCleared(actor, sessions, targetSessions, checkpointCount);
}

function getStoredCleared(actor, sessions, targetSessions, checkpointCount) {
  const stored = actor.getFlag(MODULE_ID, "clearedCheckpoint");
  // Geçilmiş checkpoint, oturum düzeltmesiyle (ör. çıkarıp geri ekleme) kaybolmaz.
  if (Number.isFinite(stored)) return stored;
  return getCheckpointSessions(targetSessions, checkpointCount).filter(value => value < sessions).pop() ?? 0;
}

function isAtCheckpoint(sessions, targetSessions, checkpointCount, clearedCheckpoint = 0) {
  return sessions > clearedCheckpoint
    && getCheckpointSessions(targetSessions, checkpointCount).includes(sessions);
}

// Eklenen oturumlar geçilmemiş ilk checkpoint'te durur; zar atılmadan atlanamaz.
function getNextBlockingCheckpoint(clearedCheckpoint, targetSessions, checkpointCount) {
  return getCheckpointSessions(targetSessions, checkpointCount).find(value => value > clearedCheckpoint)
    ?? targetSessions;
}

// Başarısız checkpoint sonrası telafi: ilerleme bir önceki checkpoint'e düşer,
// başarısız olunan noktaya kadar eklenen her oturum 2 oturum sayılır.


function getRecoveryUntil(actor, sessions) {
  if (!game.settings.get(MODULE_ID, "recoveryEnabled")) return null;
  const until = Number(actor.getFlag(MODULE_ID, "recoveryUntil"));
  return Number.isFinite(until) && until > sessions ? until : null;
}

// Telafi bölgesinde eklenen oturumlar katlanır; bölge sınırını aşan kısım normal sayılır.
function getProgressGain(current, amount, recoveryUntil) {
  if (!recoveryUntil || current >= recoveryUntil) return amount;
  const zoneSessions = Math.ceil((recoveryUntil - current) / getRecoveryMultiplier());
  if (amount <= zoneSessions) return Math.min(amount * getRecoveryMultiplier(), recoveryUntil - current);
  return (recoveryUntil - current) + (amount - zoneSessions);
}

// Checkpoint'te başarısız olma: bir önceki checkpoint'e dön ve telafi sınırını kaydet.
// steps: kaç checkpoint geriye düşüleceği (doğal 1'de 2). Düşülen noktanın üstündeki
// checkpoint'ler yeniden zar ister.
async function failCheckpoint(actor, current, targetSessions, checkpointCount, { steps = 1 } = {}) {
  const earlier = getCheckpointSessions(targetSessions, checkpointCount).filter(value => value < current);
  const previous = earlier[earlier.length - steps] ?? 0;
  const cleared = getStoredCleared(actor, current, targetSessions, checkpointCount);
  await actor.update({
    [`flags.${MODULE_ID}.sessions`]: previous,
    [`flags.${MODULE_ID}.clearedCheckpoint`]: Math.min(cleared, previous),
    [`flags.${MODULE_ID}.recoveryUntil`]: current
  });
  return previous;
}

// Tutulan d20 doğal 1 mi? (avantaj/dezavantajda tutulan zar)
function isNaturalOne(roll) {
  const d20 = roll?.d20 ?? roll?.dice?.find(die => die.faces === 20);
  if (!d20) return false;
  const kept = d20.results?.filter(result => result.active !== false && !result.discarded) ?? [];
  return kept.length > 0 && kept.every(result => result.result === 1);
}

function getCheckpointDC() {
  return cfgAllowZero("checkpointDC", CHECKPOINT_DC);
}

// Hedef: GM'in elle girdiği değer > bağlı feat'in kategorisi > varsayılan.
function getAutoTarget(actor) {
  return getFeatGoals()[actor.getFlag(MODULE_ID, "featCategory")] ?? null;
}

function getTargetSessions(actor) {
  const manual = Number(actor.getFlag(MODULE_ID, "targetSessions"));
  if (Number.isFinite(manual) && manual > 0) return manual;
  return getAutoTarget(actor) ?? DEFAULT_TARGET_SESSIONS;
}

// Bir feat'i eğitim hedefi olarak bağlar; feat karaktere eklenmez.
async function linkFeat(actor, item) {
  if (item?.type !== "feat" || item.system?.type?.value !== "feat") {
    ui.notifications.warn("Only feats can be linked to training.");
    return false;
  }
  const category = item.system.type.subtype || null;
  if (category === "epicBoon" && !game.settings.get(MODULE_ID, "allowEpicBoon")) {
    ui.notifications.warn(`${item.name} is an Epic Boon and cannot be learned through training.`);
    return false;
  }
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  // Süren bir eğitimin elle girilmiş hedefi korunur; otomatiğe geçmek GM'in Set Goal kararıdır.
  const keepManual = current > 0 && Number(actor.getFlag(MODULE_ID, "targetSessions")) > 0;
  const useAuto = Boolean(getFeatGoals()[category]) && !keepManual;
  const target = useAuto ? getFeatGoals()[category] : getTargetSessions(actor);
  await actor.update({
    [`flags.${MODULE_ID}.featUuid`]: item.uuid,
    [`flags.${MODULE_ID}.featCategory`]: category,
    [`flags.${MODULE_ID}.featIdentifier`]: item.system.identifier || null,
    [`flags.${MODULE_ID}.featRepeatable`]: Boolean(item.system.prerequisites?.repeatable),
    [`flags.${MODULE_ID}.trainingName`]: item.name,
    ...(useAuto ? {
      [`flags.${MODULE_ID}.-=targetSessions`]: null,
      [`flags.${MODULE_ID}.sessions`]: Math.min(current, target),
      [`flags.${MODULE_ID}.-=clearedCheckpoint`]: null,
      [`flags.${MODULE_ID}.-=recoveryUntil`]: null
    } : {})
  });
  if (useAuto) ui.notifications.info(`${actor.name} is now training ${item.name} (${FEAT_CATEGORY_LABELS[category]}, ${target} hours).`);
  else if (keepManual) ui.notifications.info(`${actor.name} is now training ${item.name}; the manual goal of ${target} hours was kept. Use Set Goal to switch to automatic.`);
  else ui.notifications.info(`${actor.name} is now training ${item.name}. This feat has no category; set the goal manually.`);
  return true;
}

// Karakter bu feat'e zaten sahip mi? Tekrarlanabilir feat'ler (ör. ASI) her zaman verilebilir.
function hasLinkedFeat(actor) {
  const identifier = actor.getFlag(MODULE_ID, "featIdentifier");
  const name = actor.getFlag(MODULE_ID, "trainingName");
  if (actor.getFlag(MODULE_ID, "featRepeatable")) return false;
  return actor.items.some(i => i.type === "feat"
    && ((identifier && i.system?.identifier === identifier) || i.name === name));
}

// Feat verilirken advancement seçimini önce karakterin bağlı oyuncusu yapar (pencere onun ekranında
// açılır); bağlı oyuncu yoksa, ya da GM Shift ile basarsa, seçimi GM yapar.
const SOCKET_NAME = `module.${MODULE_ID}`;

function onlineOwner(actor) {
  return game.users.find(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
}

async function grantFeat(actor, { here = false } = {}) {
  const owner = here ? null : onlineOwner(actor);
  if (!owner || hasLinkedFeat(actor)) return grantFeatHere(actor);
  game.socket.emit(SOCKET_NAME, { type: "grantFeat", actorUuid: actor.uuid, userId: owner.id });
  ui.notifications.info(`${owner.name} will choose the feat's options for ${actor.name}. Shift-click Grant feat to choose it yourself.`);
  return true;
}

// Oyuncu tarafı: GM'in isteği gelince advancement penceresi bu istemcide açılır.
async function onGrantRequest(payload, senderId) {
  if (payload?.type !== "grantFeat" || payload.userId !== game.user.id) return;
  if (!game.users.get(senderId)?.isGM) return;
  const actor = await fromUuid(payload.actorUuid);
  if (!actor?.isOwner) return;
  await grantFeatHere(actor);
}

// Bağlı feat'i karaktere ekler; dnd5e advancement adımları (ör. +1 yetenek) varsa pencereyi açar.
async function grantFeatHere(actor) {
  const feat = await fromUuid(actor.getFlag(MODULE_ID, "featUuid") ?? "");
  if (!feat) {
    ui.notifications.warn("The linked feat could not be found.");
    return false;
  }
  if (hasLinkedFeat(actor)) {
    ui.notifications.info(`${actor.name} already has ${feat.name}.`);
    return false;
  }
  const itemData = feat.pack ? game.items.fromCompendium(feat) : feat.toObject();
  if (!game.settings.get("dnd5e", "disableAdvancements")) {
    const manager = dnd5e.applications.advancement.AdvancementManager.forNewItem(actor, itemData);
    if (manager.steps.length) {
      manager.render(true);
      ui.notifications.info(`Complete the advancement to grant ${feat.name} to ${actor.name}.`);
      return true;
    }
  }
  await actor.createEmbeddedDocuments("Item", [itemData]);
  ui.notifications.info(`${actor.name} learned ${feat.name}.`);
  return true;
}

async function askGoal(currentGoal, autoGoal) {
  const buttons = [{
    action: "save", icon: "fas fa-check", label: "Save", default: true,
    callback: (event, button) => button.form.elements.amount.valueAsNumber
  }];
  if (autoGoal) buttons.push({ action: "auto", icon: "fas fa-wand-magic-sparkles", label: `Automatic (feat: ${autoGoal})`, callback: () => "auto" });
  const value = await foundry.applications.api.DialogV2.wait({
    window: { title: "Set Goal" },
    content: `
      <div class="form-group">
        <label>Target Hours</label>
        <input type="number" name="amount" value="${currentGoal}" min="1" step="1" autofocus>
      </div>
    `,
    buttons,
    rejectClose: false
  });
  if (value === "auto") return "auto";
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    ui.notifications.warn("Please enter a valid number.");
    return null;
  }
  return Math.floor(value);
}

// Oturum sayısını yazar. Geçilmiş checkpoint korunur (eski kayıtlarda değişiklikten
// önceki ilerlemeye göre türetilip kalıcı yazılır); yalnızca Reset sıfırlar.
async function setSessions(actor, sessions, targetSessions, checkpointCount, { resetCleared = false } = {}) {
  const previous = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const cleared = resetCleared ? 0 : getStoredCleared(actor, previous, targetSessions, checkpointCount);
  const update = {
    [`flags.${MODULE_ID}.sessions`]: sessions,
    [`flags.${MODULE_ID}.clearedCheckpoint`]: cleared
  };
  if (!getRecoveryUntil(actor, sessions)) update[`flags.${MODULE_ID}.-=recoveryUntil`] = null;
  await actor.update(update);
}

// İşaretler: geçilmiş (altın), zarı bekleyen (vurgulu), ileride (soluk).
function renderCheckpointMarkers(sessions, clearedCheckpoint, targetSessions, checkpointCount) {
  return getCheckpointSessions(targetSessions, checkpointCount).map(checkpointSessions => {
    const percent = (checkpointSessions / targetSessions) * 100;
    const state = checkpointSessions <= clearedCheckpoint ? "passed"
      : checkpointSessions === sessions ? "pending" : "upcoming";
    return `<span class="ft-marker ${state}" style="left: ${percent}%" title="${checkpointSessions} h"></span>`;
  }).join("");
}

async function askSessionAmount(title, defaultValue = 1, { min = 1, label = "Hours" } = {}) {
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `
      <div class="form-group">
        <label>${label}</label>
        <input type="number" name="amount" value="${defaultValue}" min="${min}" step="1" autofocus>
      </div>
    `,
    ok: {
      icon: "fas fa-check",
      label: "Apply",
      callback: (event, button) => button.form.elements.amount.valueAsNumber
    },
    rejectClose: false
  });
  if (value === null || value === undefined) return null;

  if (!Number.isFinite(value) || value < min) {
    ui.notifications.warn("Please enter a valid number.");
    return null;
  }
  return Math.floor(value);
}

// Eğitim tamamlandı: sohbete duyurur. Feat otomatik verilmez; GM sekmedeki
// "Grant Feat" düğmesiyle verir.
async function completeTraining(actor) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<b>${escapeHtml(actor.name)}</b> completed training: <b>${escapeHtml(actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME)}</b>.`
  });
  ui.notifications.info(actor.getFlag(MODULE_ID, "featUuid")
    ? `${actor.name} completed training. The GM can grant the feat from the training tab.`
    : `${actor.name} completed training.`);
}


// Ana yetenek seçilmemişse en yüksek seviyeli sınıfın primary ability'si kullanılır;
// birden fazlaysa (ör. Ranger: DEX/WIS) skoru yüksek olan, sınıf yoksa en yüksek skor.
function getAutoAbility(actor) {
  const scores = actor.system?.abilities ?? {};
  const mainClass = Object.values(actor.classes ?? {})
    .sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0))[0];
  const primary = [...(mainClass?.system?.primaryAbility?.value ?? [])].filter(key => key in ABILITIES);
  const pool = primary.length ? primary : Object.keys(ABILITIES).filter(key => key in scores);
  if (!pool.length) return null;
  return pool.reduce((best, key) => ((scores[key]?.value ?? 0) > (scores[best]?.value ?? 0) ? key : best));
}

function getMainAbility(actor) {
  return actor.getFlag(MODULE_ID, "mainAbility") ?? getAutoAbility(actor);
}

async function rollCheckpointAbilityCheck(actor, ability, targetSessions, checkpointCount) {
  // dnd5e'nin kendi ability check'i: avantaj/dezavantaj, exhaustion, bonuslar
  // ve roll dialog'u sisteme göre işler.
  const rolls = await actor.rollAbilityCheck(
    { ability, target: getCheckpointDC() },
    {},
    { data: { flavor: `Training Checkpoint — ${CONFIG.DND5E.abilities[ability]?.label ?? ability}` } }
  );
  const roll = rolls?.[0];
  if (!roll) return null;

  // Doğal 1 toplam ne olursa olsun başarısızdır ve 2 checkpoint geriletir.
  const naturalOne = isNaturalOne(roll);
  const success = roll.isSuccess && !naturalOne;
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;

  if (success) {
    // Telafi, başarısız olunan noktaya kadar sürer; aradaki checkpoint'i geçmek onu bitirmez.
    await actor.update({
      [`flags.${MODULE_ID}.clearedCheckpoint`]: current,
      ...(getRecoveryUntil(actor, current) ? {} : { [`flags.${MODULE_ID}.-=recoveryUntil`]: null })
    });
    if (current >= targetSessions) await completeTraining(actor);
    else ui.notifications.info(`${actor.name} passed the checkpoint check.`);
  } else {
    const previousCheckpoint = await failCheckpoint(actor, current, targetSessions, checkpointCount, { steps: naturalOne ? getNaturalOneSteps() : 1 });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <b>${escapeHtml(actor.name)}</b> failed the checkpoint check${naturalOne ? " with a natural 1 and fell back two checkpoints" : ""}.<br>
        Progress dropped from <b>${current}</b> hours to <b>${previousCheckpoint}</b> hours.<br>
        ${game.settings.get(MODULE_ID, "recoveryEnabled") ? `Hours count double until <b>${current}</b>.` : ""}
      `
    });

    ui.notifications.warn(`${actor.name} failed the checkpoint check and fell back ${naturalOne ? "two checkpoints (natural 1)" : "to the previous checkpoint"}.`);
  }

  return success;
}

async function renderFeatTrainingTab(sheet, actor, tab) {
  const sessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const targetSessions = getTargetSessions(actor);
  const goalIsManual = Number(actor.getFlag(MODULE_ID, "targetSessions")) > 0;
  const featCategory = actor.getFlag(MODULE_ID, "featCategory") ?? null;
  const featLinked = Boolean(actor.getFlag(MODULE_ID, "featUuid"));
  const featGranted = featLinked && hasLinkedFeat(actor);
  const checkpointCount = normalizeCheckpointCount(
    actor.getFlag(MODULE_ID, "checkpointCount") ?? getDefaultCheckpointCount()
  );
  const mainAbility = getMainAbility(actor);
  const abilityIsAuto = !actor.getFlag(MODULE_ID, "mainAbility");
  const trainingName =
    actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME;

  const remainingSessions = Math.max(targetSessions - sessions, 0);
  const percent = Math.min(100, Math.round((sessions / targetSessions) * 100));
  const completed = isTrainingComplete(actor, sessions, targetSessions, checkpointCount);
  const clearedCheckpoint = getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount);
  const checkpointReady = isAtCheckpoint(sessions, targetSessions, checkpointCount, clearedCheckpoint);
  const checkpointDC = getCheckpointDC();
  const recoveryUntil = getRecoveryUntil(actor, sessions);

  const isGM = game.user.isGM;
  const nextCheckpoint = getNextBlockingCheckpoint(clearedCheckpoint, targetSessions, checkpointCount);
  const toNext = Math.max(nextCheckpoint - sessions, 0);
  const sessionsToNext = recoveryUntil && recoveryUntil >= nextCheckpoint ? Math.ceil(toNext / getRecoveryMultiplier()) : toNext;
  const goalNote = goalIsManual ? "manual goal" : getAutoTarget(actor) ? "automatic goal" : "default goal";
  const abilityLabel = mainAbility ? (CONFIG.DND5E.abilities[mainAbility]?.abbreviation ?? mainAbility).toUpperCase() : "—";

  // Tek durum şeridi: öncelik sırasıyla tamamlandı > checkpoint > telafi.
  let banner = "";
  if (completed) {
    banner = `
      <div class="ft-banner ft-banner-complete">
        <i class="fas fa-award"></i>
        <div class="ft-banner-text"><strong>Training complete</strong>
          <span>${featLinked ? (featGranted ? "Feat granted." : (isGM ? "Grant it from the dashboard." : "Waiting for the GM to grant the feat.")) : "No feat was linked."}</span></div>
      </div>`;
  } else if (checkpointReady) {
    const final = sessions >= targetSessions;
    banner = `
      <div class="ft-banner ft-banner-checkpoint">
        <i class="fas fa-dice-d20"></i>
        <div class="ft-banner-text"><strong>${final ? "Final checkpoint" : "Checkpoint reached"}</strong>
          <span>${abilityLabel} check, DC ${checkpointDC}. ${final ? "Pass it to complete training." : "Pass it to keep training."}</span></div>
        <button type="button" class="feat-training-checkpoint-roll"><i class="fas fa-dice-d20"></i> Roll</button>
      </div>`;
  } else if (recoveryUntil) {
    banner = `
      <div class="ft-banner ft-banner-recovery">
        <i class="fas fa-forward"></i>
        <div class="ft-banner-text"><strong>Recovery</strong>
          <span>Hours count double until ${recoveryUntil} h.</span></div>
      </div>`;
  }

  if (isPlayerViewLimited()) {
    // Gizli mod: ilerleme gösterilmez, yalnızca checkpoint zarı.
    tab.innerHTML = `
      <div class="feat-training-content ft">
        <header class="ft-header"><div class="ft-title"><span class="ft-eyebrow">Feat Training</span><h2>Checkpoint</h2></div></header>
        ${checkpointReady && !completed ? banner : `<div class="ft-banner"><i class="fas fa-check"></i><div class="ft-banner-text"><strong>Nothing to roll</strong></div></div>`}
      </div>
    `;
  } else tab.innerHTML = `
    <div class="feat-training-content ft">
      <header class="ft-header">
        <div class="ft-title">
          <span class="ft-eyebrow">Feat Training</span>
          <h2>${featLinked ? escapeHtml(trainingName) : (actor.getFlag(MODULE_ID, "trainingName") ? escapeHtml(trainingName) : "No feat in training")}</h2>
        </div>
        ${featCategory ? `<span class="ft-badge">${FEAT_CATEGORY_LABELS[featCategory] ?? featCategory}</span>` : ""}
      </header>


      <section class="ft-progress">
        <div class="ft-bar">
          <div class="ft-bar-fill" style="width: ${percent}%"></div>
          ${renderCheckpointMarkers(sessions, clearedCheckpoint, targetSessions, checkpointCount)}
        </div>
        <div class="ft-progress-meta">
          <span class="ft-percent">${percent}%</span>
          ${isGM ? `<span>${sessions} / ${targetSessions} hours <em>· ${goalNote}</em></span>` : ""}
        </div>
      </section>

      <section class="ft-stats">
        ${isGM ? `
          <div class="ft-stat"><span class="ft-stat-value">${remainingSessions}</span><span class="ft-stat-label">hours left</span></div>` : ""}
        <div class="ft-stat"><span class="ft-stat-value">${completed ? "—" : checkpointReady ? "Now" : sessionsToNext}</span><span class="ft-stat-label">${completed ? "all checkpoints passed" : checkpointReady ? "checkpoint check" : "hours to next checkpoint"}</span></div>
        <div class="ft-stat"><span class="ft-stat-value">${abilityLabel}</span><span class="ft-stat-label">check · DC ${checkpointDC}${isGM && mainAbility && abilityIsAuto ? " · from class" : ""}</span></div>
      </section>

      ${banner}

      ${isGM ? `
        <footer class="ft-actions">
          <button type="button" class="feat-training-open-dashboard" data-tooltip="Manage all trainings"><i class="fas fa-table-list"></i> Open dashboard</button>
        </footer>` : ""}
    </div>
  `;

  tab.querySelector(".feat-training-checkpoint-roll")?.addEventListener("click", async event => {
    // Çift tıklama: aynı karakter için süren bir checkpoint zarı varsa yenisi açılmaz.
    const rollKey = getActorKey(actor);
    if (CHECKPOINT_ROLLS.has(rollKey)) return;
    CHECKPOINT_ROLLS.add(rollKey);
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await rollCheckpointFromTab();
    } finally {
      CHECKPOINT_ROLLS.delete(rollKey);
      button.disabled = false;
    }
  });

  async function rollCheckpointFromTab() {
    const ability = getMainAbility(actor);

    if (!ability) {
      ui.notifications.warn("Main Ability has not been set yet.");
      return;
    }

    const currentSessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const cleared = getClearedCheckpoint(actor, currentSessions, targetSessions, checkpointCount);

    if (!isAtCheckpoint(currentSessions, targetSessions, checkpointCount, cleared)) {
      ui.notifications.warn("This character is not currently at a checkpoint.");
      return;
    }

    await rollCheckpointAbilityCheck(actor, ability, targetSessions, checkpointCount);
    await renderFeatTrainingTab(sheet, actor, tab);
  }

  tab.querySelector(".feat-training-open-dashboard")?.addEventListener("click", () => openDashboard());
}

// Hedefe ulaşılınca: zar gerekiyorsa son checkpoint hatırlatılır; checkpoint yoksa ya da DC 0 ise
// eğitim doğrudan tamamlanır (Grant feat hazır).
async function announceReachedTarget(actor, checkpointCount) {
  if (checkpointCount > 0 && getCheckpointDC() > 0) {
    ui.notifications.info(`${actor.name} reached the final checkpoint; pass its check to complete training.`);
  } else await completeTraining(actor);
}

// Saat ekler: geçilmemiş checkpoint'te durur, telafi bölgesinde katlanır. Sekme ve dashboard kullanır.
async function addHours(actor, amount) {
  const targetSessions = getTargetSessions(actor);
  const checkpointCount = normalizeCheckpointCount(actor.getFlag(MODULE_ID, "checkpointCount") ?? getDefaultCheckpointCount());
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const cleared = getClearedCheckpoint(actor, current, targetSessions, checkpointCount);

  if (isAtCheckpoint(current, targetSessions, checkpointCount, cleared)) {
    ui.notifications.warn(`${actor.name} must pass the checkpoint check before more hours can be added.`);
    return;
  }

  const limit = getNextBlockingCheckpoint(cleared, targetSessions, checkpointCount);
  const gain = getProgressGain(current, amount, getRecoveryUntil(actor, current));
  // Eşiği aşmış ilerleme (ör. checkpoint sonradan açıldıysa) hiçbir zaman geriye gitmez.
  const next = Math.max(current, Math.min(current + gain, limit));

  await setSessions(actor, next, targetSessions, checkpointCount);

  if (next >= targetSessions && current < targetSessions) {
    await announceReachedTarget(actor, checkpointCount);
  } else if (next < current + gain) {
    ui.notifications.info(`${actor.name} reached a checkpoint at ${next} h; the remaining hours were not added.`);
  } else if (gain > amount) {
    ui.notifications.info(`${actor.name} is recovering: ${amount} hours counted as ${gain}.`);
  }
}

// Saat sayısını doğrudan yazar (GM kararı): değerin altındaki checkpoint'ler geçilmiş sayılır,
// değer tam bir checkpoint'teyse onun zarı yine istenir.
async function setHoursDialog(actor) {
  const targetSessions = getTargetSessions(actor);
  const checkpointCount = normalizeCheckpointCount(actor.getFlag(MODULE_ID, "checkpointCount") ?? getDefaultCheckpointCount());
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const value = await askSessionAmount("Set hours", current, { min: 0 });
  if (value === null) return;

  const next = Math.min(value, targetSessions);
  const cleared = Math.max(
    getStoredCleared(actor, current, targetSessions, checkpointCount),
    getCheckpointSessions(targetSessions, checkpointCount).filter(v => v < next).pop() ?? 0
  );
  await actor.update({
    [`flags.${MODULE_ID}.sessions`]: next,
    [`flags.${MODULE_ID}.clearedCheckpoint`]: cleared,
    ...(getRecoveryUntil(actor, next) ? {} : { [`flags.${MODULE_ID}.-=recoveryUntil`]: null })
  });

  if (next >= targetSessions && current < targetSessions) {
    await announceReachedTarget(actor, checkpointCount);
  } else ui.notifications.info(`${actor.name}'s hours were set to ${next}.`);
}

async function goalDialog(actor) {
  const autoGoal = getAutoTarget(actor);
  const choice = await askGoal(getTargetSessions(actor), autoGoal);
  if (choice === null) return;
  const amount = choice === "auto" ? autoGoal : choice;
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;

  // Checkpoint konumları hedefe bağlı; geçilmiş checkpoint yeniden türetilir.
  await actor.update({
    ...(choice === "auto"
      ? { [`flags.${MODULE_ID}.-=targetSessions`]: null }
      : { [`flags.${MODULE_ID}.targetSessions`]: amount }),
    [`flags.${MODULE_ID}.sessions`]: Math.min(current, amount),
    [`flags.${MODULE_ID}.-=clearedCheckpoint`]: null,
    [`flags.${MODULE_ID}.-=recoveryUntil`]: null
  });
  ui.notifications.info(`${actor.name}'s target was set to ${amount} hours${choice === "auto" ? " (automatic)" : ""}.`);
}

// Eğitimi tamamen kaldırır: saat, hedef ve feat bağı silinir (karaktere zaten verilmiş feat'e dokunmaz).
async function removeTraining(actor) {
  const name = actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Remove Training" },
    content: `<p>Remove <b>${escapeHtml(name)}</b> training from <b>${escapeHtml(actor.name)}</b>? The hours and the feat link are cleared. A feat the character already has is not touched.</p>`,
    no: { default: true },
    rejectClose: false
  });
  if (!ok) return;
  await resetTraining(actor);
  ui.notifications.info(`${actor.name}'s training was removed.`);
}

// Yanlış verilen feat'i karakterden siler. dnd5e'nin kendi silme penceresi kullanılır, böylece feat'in
// advancement'ı (ör. yetenek artışı) için dnd5e'nin geri alma akışı devreye girebilir.
async function undoGrant(actor) {
  const item = actor.items.get(actor.getFlag(MODULE_ID, "lastGranted")?.itemId ?? "");
  if (!item) return ui.notifications.warn("The granted feat is no longer on the character.");
  const deleted = await item.deleteDialog();
  if (deleted) await actor.unsetFlag(MODULE_ID, "lastGranted");
}

async function resetDialog(actor) {
  const confirmReset = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Reset Training" },
    content: `<p>Reset training progress for <b>${escapeHtml(actor.name)}</b>?</p>`,
    no: { default: true },
    rejectClose: false
  });
  if (!confirmReset) return;
  const targetSessions = getTargetSessions(actor);
  const checkpointCount = normalizeCheckpointCount(actor.getFlag(MODULE_ID, "checkpointCount") ?? getDefaultCheckpointCount());
  await setSessions(actor, 0, targetSessions, checkpointCount, { resetCleared: true });
}

// ---------------- GM dashboard ----------------
let dashboard = null;

// Tüm karakterler (eğitimi başlamamış olanlar da "No feat" satırı olarak görünür).
function trainingRows() {
  return game.actors
    .filter(a => a.type === "character")
    .map(actor => {
      const sessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
      const target = getTargetSessions(actor);
      const count = normalizeCheckpointCount(actor.getFlag(MODULE_ID, "checkpointCount") ?? getDefaultCheckpointCount());
      const cleared = getClearedCheckpoint(actor, sessions, target, count);
      const linked = Boolean(actor.getFlag(MODULE_ID, "featUuid"));
      return {
        actor, sessions, target, count, cleared, linked,
        completed: linked && isTrainingComplete(actor, sessions, target, count),
        ready: linked && isAtCheckpoint(sessions, target, count, cleared),
        recovery: linked ? getRecoveryUntil(actor, sessions) : null,
        granted: linked && hasLinkedFeat(actor),
        undoItem: actor.items.get(actor.getFlag(MODULE_ID, "lastGranted")?.itemId ?? ""),
        percent: Math.min(100, Math.round((sessions / target) * 100))
      };
    })
    .sort((a, b) => (b.linked - a.linked) || (b.completed - a.completed) || (b.ready - a.ready)
      || (b.percent - a.percent) || a.actor.name.localeCompare(b.actor.name));
}

function statusChip(r) {
  if (!r.linked) return '<span class="ftd-chip ftd-muted">No feat</span>';
  if (r.completed) return r.granted ? '<span class="ftd-chip ftd-ok">Feat granted</span>' : '<span class="ftd-chip ftd-done">Complete</span>';
  if (r.ready) return '<span class="ftd-chip ftd-check">Checkpoint</span>';
  if (r.recovery) return '<span class="ftd-chip ftd-recover">Recovery x' + getRecoveryMultiplier() + "</span>";
  return '<span class="ftd-chip">Training</span>';
}

function actionButton(act, icon, label, tip, { disabled = false, danger = false, primary = false } = {}) {
  const cls = ["ftd-btn", danger ? "ftd-btn-danger" : "", primary ? "ftd-btn-primary" : ""].join(" ").trim();
  return `<button type="button" data-act="${act}" data-tooltip="${tip}" class="${cls}" ${disabled ? "disabled" : ""}><i class="fas fa-${icon}"></i> ${label}</button>`;
}

function dashboardHtml() {
  const rows = trainingRows();
  if (!rows.length) return '<p class="ftd-empty">No player characters found.</p>';
  const count = fn => rows.filter(fn).length;
  const summary = `<div class="ftd-summary">
    <span><strong>${count(r => r.linked && !r.completed)}</strong> training</span>
    <span><strong>${count(r => r.ready)}</strong> at checkpoint</span>
    <span><strong>${count(r => r.completed && !r.granted)}</strong> ready to grant</span>
    <span><strong>${count(r => !r.linked)}</strong> without a feat</span>
  </div>`;
  const body = rows.map(r => {
    const name = r.actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME;
    const category = r.actor.getFlag(MODULE_ID, "featCategory");
    const noFeat = !r.linked;
    const grant = r.completed && !r.granted ? actionButton("grant", "award", "Grant feat", "The player chooses the feat's options when online (Shift-click: you choose)", { primary: true }) : "";
    const rowClass = r.ready ? "ftd-row-check" : r.completed && !r.granted ? "ftd-row-done" : "";
    return `<tr data-actor="${r.actor.id}" class="${rowClass}">
      <td class="ftd-name"><img src="${r.actor.img}" alt=""><a data-act="sheet">${escapeHtml(r.actor.name)}</a></td>
      <td>${noFeat ? '<em class="ftd-drop"><i class="fas fa-hand-pointer"></i> Drop a feat here</em>'
        : escapeHtml(name) + (category ? " <small>" + (FEAT_CATEGORY_LABELS[category] ?? category) + "</small>" : "")}</td>
      <td class="ftd-progress">${noFeat ? "—" : `
        <div class="ft-bar"><div class="ft-bar-fill" style="width: ${r.percent}%"></div>${renderCheckpointMarkers(r.sessions, r.cleared, r.target, r.count)}</div>
        <small>${r.sessions} / ${r.target} h · ${r.percent}%</small>`}
      </td>
      <td>${statusChip(r)}</td>
      <td class="ftd-actions"><div class="ftd-btns">
        ${grant}
        ${actionButton("add", "plus", "Add hours", "Add the hours the character trained", { disabled: noFeat })}
        ${actionButton("set", "pen-to-square", "Set hours", "Write the total hours directly", { disabled: noFeat })}
        ${actionButton("goal", "bullseye", "Goal", "Change the target hours", { disabled: noFeat })}
        ${actionButton("reset", "rotate-left", "Reset", "Set the hours back to 0 (keeps the feat)", { disabled: noFeat, danger: true })}
        ${actionButton("unlink", "link-slash", "Remove", "Remove this training completely (hours and feat)", { disabled: noFeat, danger: true })}
        ${r.undoItem ? actionButton("undo", "trash", "Undo grant", `Delete the granted ${escapeHtml(r.undoItem.name)} from the character`, { danger: true }) : ""}
      </div></td>
    </tr>`;
  }).join("");
  return `${summary}<table class="ftd-table"><thead><tr><th>Character</th><th>Feat</th><th>Progress</th><th>Status</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table>`;
}

const DASHBOARD_ACTIONS = {
  add: async actor => {
    const amount = await askSessionAmount("How many hours were trained?", 4);
    if (amount !== null) await addHours(actor, amount);
  },
  set: setHoursDialog,
  goal: goalDialog,
  reset: resetDialog,
  unlink: removeTraining,
  undo: undoGrant,
  grant: (actor, event) => grantFeat(actor, { here: event?.shiftKey })
};

function wireDashboard(root) {
  root.querySelectorAll("tr[data-actor]").forEach(row => {
    const actor = game.actors.get(row.dataset.actor);
    row.querySelector('[data-act="sheet"]')?.addEventListener("click", () => actor.sheet.render(true));
    for (const [act, handler] of Object.entries(DASHBOARD_ACTIONS)) {
      row.querySelector(`button[data-act="${act}"]`)?.addEventListener("click", event => handler(actor, event));
    }
    // Feat sürükle-bırak: bir feat'i satırın üstüne bırakmak eğitimi başlatır.
    row.addEventListener("dragover", event => { event.preventDefault(); row.classList.add("ftd-over"); });
    row.addEventListener("dragleave", () => row.classList.remove("ftd-over"));
    row.addEventListener("drop", async event => {
      row.classList.remove("ftd-over");
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Item") return;
      event.preventDefault();
      event.stopPropagation();
      await linkFeat(actor, await fromUuid(data.uuid));
    });
  });
}

function refreshDashboard() {
  const content = dashboard?.element?.querySelector(".ftd-trainings");
  if (!content) return;
  content.innerHTML = dashboardHtml();
  wireDashboard(content);
}

// ---------------- Dashboard: ayarlar sekmesi ----------------
// Modül ayarları Foundry'nin ayar penceresinde değil, dashboard'ın Settings sekmesinde yönetilir.
// Ad, ipucu ve varsayılan değerler ayar kaydından okunur (init kancasında).
const SETTING_GROUPS = [
  { title: "Visibility", items: [{ key: "showToPlayers", type: "bool" }] },
  { title: "Checkpoints", items: [{ key: "checkpointDC", type: "number", min: 0 }, { key: "defaultCheckpointCount", type: "number", min: 0 }] },
  { title: "Failure and recovery", items: [
    { key: "recoveryEnabled", type: "bool" },
    { key: "recoveryMultiplier", type: "number", min: 1, step: 0.5 },
    { key: "naturalOneSteps", type: "number", min: 1 }
  ] },
  { title: "Goals (hours)", items: [
    { key: "goalOriginHours", type: "number", min: 1 },
    { key: "goalFightingStyleHours", type: "number", min: 1 },
    { key: "goalGeneralHours", type: "number", min: 1 },
    { key: "allowEpicBoon", type: "bool" }
  ] }
];

function settingDef(key) {
  return game.settings.settings.get(`${MODULE_ID}.${key}`);
}

function settingsHtml() {
  const groups = SETTING_GROUPS.map(group => {
    const items = group.items.map(item => {
      const def = settingDef(item.key);
      const value = game.settings.get(MODULE_ID, item.key);
      const text = `<span class="ftd-set-text"><strong>${escapeHtml(def.name)}</strong><small>${escapeHtml(def.hint ?? "")}</small></span>`;
      const input = item.type === "bool"
        ? `<input type="checkbox" name="${item.key}" ${value ? "checked" : ""}>`
        : `<input type="number" name="${item.key}" value="${value}" min="${item.min ?? 0}" step="${item.step ?? 1}">`;
      return `<label class="ftd-set ftd-set-${item.type}">${item.type === "bool" ? input + text : text + input}</label>`;
    }).join("");
    return `<section class="ftd-set-group"><h3>${group.title}</h3>${items}</section>`;
  }).join("");
  return `${groups}<footer class="ftd-set-footer"><span class="ftd-saved" hidden><i class="fas fa-check"></i> Saved</span><button type="button" data-act="defaults"><i class="fas fa-rotate-left"></i> Reset to defaults</button></footer>`;
}

function wireSettings(root) {
  const flash = () => {
    const mark = root.querySelector(".ftd-saved");
    if (!mark) return;
    mark.hidden = false;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { mark.hidden = true; }, 1500);
  };
  const apply = async (key, value) => {
    await game.settings.set(MODULE_ID, key, value);
    flash();
    refreshDashboard();
    // Açık karakter sayfaları yeni kurallara göre yenilenir (DC, hedefler vb.).
    for (const app of foundry.applications.instances.values()) {
      if (app.document?.documentName === "Actor") app.render();
    }
  };

  root.addEventListener("change", async event => {
    const input = event.target;
    const item = SETTING_GROUPS.flatMap(g => g.items).find(i => i.key === input.name);
    if (!item) return;
    if (item.type === "bool") return apply(item.key, input.checked);
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < (item.min ?? 0)) {
      input.value = game.settings.get(MODULE_ID, item.key);
      return ui.notifications.warn(`${settingDef(item.key).name}: enter a number of at least ${item.min ?? 0}.`);
    }
    return apply(item.key, value);
  });

  root.querySelector('[data-act="defaults"]')?.addEventListener("click", async () => {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reset to defaults" },
      content: "<p>Reset every Feat Training rule to its default value?</p>",
      no: { default: true },
      rejectClose: false
    });
    if (!ok) return;
    for (const { key } of SETTING_GROUPS.flatMap(g => g.items)) await game.settings.set(MODULE_ID, key, settingDef(key).default);
    root.innerHTML = settingsHtml();
    wireSettings(root);
    refreshDashboard();
  });
}

let dashboardTab = "trainings";

function dashboardShell() {
  const tab = (id, icon, label) => `<a data-tab="${id}" class="${dashboardTab === id ? "active" : ""}"><i class="fas fa-${icon}"></i> ${label}</a>`;
  return `<div class="ftd">
    <nav class="ftd-tabs">${tab("trainings", "table-list", "Trainings")}${tab("settings", "sliders", "Settings")}</nav>
    <div class="ftd-panel ftd-trainings ${dashboardTab === "trainings" ? "active" : ""}">${dashboardHtml()}</div>
    <div class="ftd-panel ftd-settings ${dashboardTab === "settings" ? "active" : ""}">${settingsHtml()}</div>
  </div>`;
}

function wireTabs(root) {
  root.querySelectorAll(".ftd-tabs a").forEach(link => link.addEventListener("click", () => {
    dashboardTab = link.dataset.tab;
    root.querySelectorAll(".ftd-tabs a").forEach(a => a.classList.toggle("active", a === link));
    root.querySelector(".ftd-trainings").classList.toggle("active", dashboardTab === "trainings");
    root.querySelector(".ftd-settings").classList.toggle("active", dashboardTab === "settings");
  }));
}

async function openDashboard() {
  if (!game.user.isGM) return ui.notifications.warn("Feat Training: only the GM can open the dashboard.");
  if (dashboard?.rendered) return dashboard.bringToFront();
  dashboard = new foundry.applications.api.DialogV2({
    classes: ["ftd-dialog"],
    window: { title: "Feat Training — Dashboard", icon: "fas fa-graduation-cap", resizable: true },
    // Sabit bir yükseklik: içerik taşınca ilgili sekme kendi içinde kaydırılır.
    position: { width: Math.min(1240, window.innerWidth - 60), height: Math.min(820, window.innerHeight - 80) },
    content: dashboardShell(),
    buttons: [{ action: "close", label: "Close", default: true }]
  });
  await dashboard.render({ force: true });
  const root = dashboard.element.querySelector(".ftd");
  wireDashboard(root.querySelector(".ftd-trainings"));
  wireSettings(root.querySelector(".ftd-settings"));
  wireTabs(root);
  return dashboard;
}

// Ayarlar Foundry'nin ayar penceresinde görünmez; oradan dashboard açılır.
class FeatTrainingDashboardMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    openDashboard();
    return this;
  }
}

Hooks.on("updateActor", (actor, changes) => {
  if (dashboard?.rendered && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) refreshDashboard();
});
Hooks.on("createItem", () => { if (dashboard?.rendered) refreshDashboard(); });
Hooks.on("deleteItem", () => { if (dashboard?.rendered) refreshDashboard(); });

Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if (!game.user.isGM || !tokens?.tools) return;
  tokens.tools.featTrainingDashboard = {
    name: "featTrainingDashboard", title: "Feat Training Dashboard", icon: "fas fa-graduation-cap",
    order: Object.keys(tokens.tools).length, button: true, visible: true, onChange: () => openDashboard()
  };
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { openDashboard };
  game.socket.on(SOCKET_NAME, onGrantRequest);
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

})();
