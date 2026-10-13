(() => {

const MODULE_ID = "feat-training";
const DEFAULT_TARGET_SESSIONS = 320;
const DEFAULT_CHECKPOINT_COUNT = 10;
const DEFAULT_TRAINING_NAME = "Feat Training Tracker";
const HOURS_PER_SESSION = 4;
const TAB_ID = "feat-training";
const DEFAULT_CHECKPOINT_DC = 15;
const ACTIVE_TABS = globalThis.FeatTrainingActiveTabs ??= new Map();

const ABILITIES = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready.`);
});

Hooks.on("renderCharacterActorSheet", async (sheet, html) => {
  await injectTrainingTab(sheet, html);
});

Hooks.on("renderNPCActorSheet", async (sheet, html) => {
  if (!game.user.isGM) return;
  await injectTrainingTab(sheet, html);
});

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
  if (!Number.isFinite(count) || count < 1) return DEFAULT_CHECKPOINT_COUNT;
  return Math.floor(count);
}

function getCheckpointSessions(targetSessions, checkpointCount) {
  const count = normalizeCheckpointCount(checkpointCount);

  return Array.from({ length: Math.max(count - 1, 0) }, (_, index) => {
    const checkpointNumber = index + 1;
    return Math.round((targetSessions / count) * checkpointNumber);
  }).filter(value => value > 0 && value < targetSessions);
}

// En yüksek geçilmiş checkpoint (oturum sayısı olarak). Flag yoksa (eski
// kayıtlar) mevcut ilerlemenin kesin olarak gerisinde kalan checkpoint'ler
// geçilmiş sayılır; tam üzerinde durulan checkpoint ise henüz geçilmemiştir.
function getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount) {
  const stored = actor.getFlag(MODULE_ID, "clearedCheckpoint");
  if (Number.isFinite(stored)) return Math.min(stored, sessions);
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

function getCheckpointDC(actor) {
  const dc = Number(actor.getFlag(MODULE_ID, "checkpointDC"));
  return Number.isFinite(dc) && dc > 0 ? Math.floor(dc) : DEFAULT_CHECKPOINT_DC;
}

// Oturum sayısı veya checkpoint düzeni değiştiğinde geçilmiş checkpoint'i
// yeni ilerlemeyle tutarlı tutar.
async function setSessions(actor, sessions, targetSessions, checkpointCount) {
  const cleared = getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount);
  const valid = getCheckpointSessions(targetSessions, checkpointCount)
    .filter(value => value <= cleared && value <= sessions).pop() ?? 0;
  await actor.update({
    [`flags.${MODULE_ID}.sessions`]: sessions,
    [`flags.${MODULE_ID}.clearedCheckpoint`]: valid
  });
}

function getPreviousCheckpoint(currentSessions, targetSessions, checkpointCount) {
  const checkpoints = getCheckpointSessions(targetSessions, checkpointCount);
  const previous = checkpoints.filter(value => value < currentSessions).pop();
  return previous ?? 0;
}

function renderCheckpointMarkers(sessions, targetSessions, checkpointCount) {
  const checkpoints = getCheckpointSessions(targetSessions, checkpointCount);

  return checkpoints.map(checkpointSessions => {
    const checkpointPercent = Math.round((checkpointSessions / targetSessions) * 100);
    const completed = sessions >= checkpointSessions ? "completed" : "";

    return `
      <div
        class="feat-training-checkpoint ${completed}"
        title="${checkpointPercent}% - ${checkpointSessions} sessions"
        style="left: ${checkpointPercent}%;">
      </div>
    `;
  }).join("");
}

async function askSessionAmount(title, defaultValue = 1) {
  return new Promise(resolve => {
    let resolved = false;

    new Dialog({
      title,
      content: `
        <form>
          <div class="form-group">
            <label>Session Count</label>
            <input type="number" name="amount" value="${defaultValue}" min="1" step="1">
          </div>
        </form>
      `,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "Apply",
          callback: html => {
            resolved = true;
            const value = Number(html.find('[name="amount"]').val());

            if (!Number.isFinite(value) || value <= 0) {
              ui.notifications.warn("Please enter a valid number.");
              resolve(null);
              return;
            }

            resolve(Math.floor(value));
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => {
            resolved = true;
            resolve(null);
          }
        }
      },
      default: "ok",
      close: () => {
        if (!resolved) resolve(null);
      }
    }).render(true);
  });
}

async function askTrainingName(currentName = DEFAULT_TRAINING_NAME) {
  return new Promise(resolve => {
    let resolved = false;

    new Dialog({
      title: "Training Name",
      content: `
        <form>
          <div class="form-group">
            <label>Training Name</label>
            <input type="text" name="trainingName" value="${escapeHtml(currentName)}">
          </div>
        </form>
      `,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "Save",
          callback: html => {
            resolved = true;
            const value = html.find('[name="trainingName"]').val()?.trim();
            resolve(value || null);
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => {
            resolved = true;
            resolve(null);
          }
        }
      },
      default: "ok",
      close: () => {
        if (!resolved) resolve(null);
      }
    }).render(true);
  });
}

async function askMainAbility(currentAbility = "str") {
  return new Promise(resolve => {
    let resolved = false;

    const options = Object.entries(ABILITIES)
      .map(([key, label]) => `
        <option value="${key}" ${key === currentAbility ? "selected" : ""}>
          ${label}
        </option>
      `)
      .join("");

    new Dialog({
      title: "Set Main Ability",
      content: `
        <form>
          <div class="form-group">
            <label>Main Ability</label>
            <select name="ability">${options}</select>
          </div>
        </form>
      `,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "Save",
          callback: html => {
            resolved = true;
            resolve(html.find('[name="ability"]').val());
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => {
            resolved = true;
            resolve(null);
          }
        }
      },
      default: "ok",
      close: () => {
        if (!resolved) resolve(null);
      }
    }).render(true);
  });
}

async function rollCheckpointAbilityCheck(actor, ability, targetSessions, checkpointCount) {
  // dnd5e'nin kendi ability check'i: avantaj/dezavantaj, exhaustion, bonuslar
  // ve roll dialog'u sisteme göre işler.
  const rolls = await actor.rollAbilityCheck(
    { ability, target: getCheckpointDC(actor) },
    {},
    { data: { flavor: `Training Checkpoint — ${CONFIG.DND5E.abilities[ability]?.label ?? ability}` } }
  );
  const roll = rolls?.[0];
  if (!roll) return null;

  const success = roll.isSuccess;
  const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;

  if (success) {
    await actor.setFlag(MODULE_ID, "clearedCheckpoint", current);
    ui.notifications.info(`${actor.name} passed the checkpoint check.`);
  } else {
    const previousCheckpoint = getPreviousCheckpoint(current, targetSessions, checkpointCount);

    await setSessions(actor, previousCheckpoint, targetSessions, checkpointCount);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <b>${escapeHtml(actor.name)}</b> failed the checkpoint check.<br>
        Progress dropped from <b>${current}</b> sessions to <b>${previousCheckpoint}</b> sessions.
      `
    });

    ui.notifications.warn(`${actor.name} failed the checkpoint check and returned to the previous checkpoint.`);
  }

  return success;
}

async function renderFeatTrainingTab(sheet, actor, tab) {
  const sessions = actor.getFlag(MODULE_ID, "sessions") ?? 0;
  const targetSessions =
    actor.getFlag(MODULE_ID, "targetSessions") ?? DEFAULT_TARGET_SESSIONS;
  const checkpointCount = normalizeCheckpointCount(
    actor.getFlag(MODULE_ID, "checkpointCount") ?? DEFAULT_CHECKPOINT_COUNT
  );
  const mainAbility = actor.getFlag(MODULE_ID, "mainAbility") ?? null;
  const trainingName =
    actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME;

  const totalHours = sessions * HOURS_PER_SESSION;
  const targetHours = targetSessions * HOURS_PER_SESSION;
  const remainingSessions = Math.max(targetSessions - sessions, 0);
  const remainingHours = remainingSessions * HOURS_PER_SESSION;
  const percent = Math.min(100, Math.round((sessions / targetSessions) * 100));
  const completed = sessions >= targetSessions;
  const clearedCheckpoint = getClearedCheckpoint(actor, sessions, targetSessions, checkpointCount);
  const checkpointReady = isAtCheckpoint(sessions, targetSessions, checkpointCount, clearedCheckpoint);
  const checkpointDC = getCheckpointDC(actor);

  tab.innerHTML = `
    <div class="feat-training-content">
      <h2>${escapeHtml(trainingName)}</h2>

      <div class="feat-training-card">
        <div class="feat-training-bar">
          ${renderCheckpointMarkers(sessions, targetSessions, checkpointCount)}
          <div class="feat-training-bar-fill" style="width: ${percent}%"></div>
        </div>

        ${
          game.user.isGM
            ? `
              <p><b>Sessions:</b> ${sessions}/${targetSessions}</p>
              <p><b>Time:</b> ${totalHours}/${targetHours} hours</p>
              <p><b>Completion:</b> ${percent}%</p>
              <p><b>Remaining:</b> ${remainingSessions} sessions (${remainingHours} hours)</p>
              <p><b>Checkpoint Count:</b> ${checkpointCount}</p>
              <p><b>Main Ability:</b> ${mainAbility ? ABILITIES[mainAbility] : "Not set"}</p>
              <p><b>Checkpoint DC:</b> ${checkpointDC}</p>
              ${checkpointReady ? `<p><b>Checkpoint:</b> Check required before more sessions can be added.</p>` : ""}
              ${completed ? `<p class="feat-training-completed"><b>Training complete.</b></p>` : ""}
            `
            : `
              <p><b>Completion:</b> ${percent}%</p>
              ${
                checkpointReady
                  ? `
                    <button type="button" class="feat-training-checkpoint-roll">
                      <i class="fas fa-dice-d20"></i> Checkpoint Check
                    </button>
                  `
                  : ""
              }
            `
        }
      </div>

      ${
        game.user.isGM
          ? `
            <div class="feat-training-actions">
              <button type="button" class="feat-training-name">
                <i class="fas fa-pen"></i> Training Name
              </button>

              <button type="button" class="feat-training-add-custom">
                <i class="fas fa-plus"></i> Add Sessions
              </button>

              <button type="button" class="feat-training-subtract-custom">
                <i class="fas fa-minus"></i> Remove Sessions
              </button>

              <button type="button" class="feat-training-target">
                <i class="fas fa-bullseye"></i> Set Goal
              </button>

              <button type="button" class="feat-training-checkpoint-count">
                <i class="fas fa-list-ol"></i> Checkpoint Count
              </button>

              <button type="button" class="feat-training-main-ability">
                <i class="fas fa-brain"></i> Set Main Ability
              </button>

              <button type="button" class="feat-training-checkpoint-dc">
                <i class="fas fa-shield-halved"></i> Checkpoint DC
              </button>

              ${
                checkpointReady
                  ? `
                    <button type="button" class="feat-training-checkpoint-roll">
                      <i class="fas fa-dice-d20"></i> Checkpoint Check
                    </button>
                  `
                  : ""
              }

              <button type="button" class="feat-training-checkpoint-back">
                <i class="fas fa-arrow-rotate-left"></i> Fail Checkpoint
              </button>

              <button type="button" class="feat-training-reset">
                <i class="fas fa-undo"></i> Reset
              </button>
            </div>
          `
          : ""
      }
    </div>
  `;

  tab.querySelector(".feat-training-checkpoint-roll")?.addEventListener("click", async () => {
    const ability = actor.getFlag(MODULE_ID, "mainAbility");

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
  });

  if (!game.user.isGM) return;

  tab.querySelector(".feat-training-checkpoint-count")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("New checkpoint count", checkpointCount);
    if (amount === null) return;

    // Checkpoint konumları değişti; geçilmiş checkpoint yeni düzene göre yeniden türetilir.
    await actor.update({
      [`flags.${MODULE_ID}.checkpointCount`]: amount,
      [`flags.${MODULE_ID}.-=clearedCheckpoint`]: null
    });

    ui.notifications.info(`${actor.name}'s checkpoint count was set to ${amount}.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-checkpoint-dc")?.addEventListener("click", async () => {
    const dc = await askSessionAmount("New checkpoint DC", checkpointDC);
    if (dc === null) return;

    await actor.setFlag(MODULE_ID, "checkpointDC", dc);

    ui.notifications.info(`${actor.name}'s checkpoint DC was set to ${dc}.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-name")?.addEventListener("click", async () => {
    const currentName =
      actor.getFlag(MODULE_ID, "trainingName") ?? DEFAULT_TRAINING_NAME;

    const newName = await askTrainingName(currentName);
    if (!newName) return;

    await actor.setFlag(MODULE_ID, "trainingName", newName);

    ui.notifications.info(`${actor.name}'s training name was updated.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-add-custom")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("How many sessions should be added?", 1);
    if (amount === null) return;

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const cleared = getClearedCheckpoint(actor, current, targetSessions, checkpointCount);

    if (isAtCheckpoint(current, targetSessions, checkpointCount, cleared)) {
      ui.notifications.warn(`${actor.name} must pass the checkpoint check before more sessions can be added.`);
      return;
    }

    const limit = getNextBlockingCheckpoint(cleared, targetSessions, checkpointCount);
    const next = Math.min(current + amount, limit);

    await setSessions(actor, next, targetSessions, checkpointCount);

    if (next >= targetSessions) {
      ui.notifications.info(`${actor.name} completed training.`);
    } else if (next < current + amount) {
      ui.notifications.info(
        `${actor.name} reached a checkpoint at ${next} sessions; ${current + amount - next} sessions were not added.`
      );
    }

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-subtract-custom")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("How many sessions should be removed?", 1);
    if (amount === null) return;

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const next = Math.max(current - amount, 0);
    const removed = current - next;

    await setSessions(actor, next, targetSessions, checkpointCount);
    ui.notifications.info(`${removed} sessions were removed from ${actor.name}.`);

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-target")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("New target session count", targetSessions);
    if (amount === null) return;

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;

    // Checkpoint konumları hedefe bağlı; geçilmiş checkpoint yeniden türetilir.
    await actor.update({
      [`flags.${MODULE_ID}.targetSessions`]: amount,
      [`flags.${MODULE_ID}.sessions`]: Math.min(current, amount),
      [`flags.${MODULE_ID}.-=clearedCheckpoint`]: null
    });

    ui.notifications.info(`${actor.name}'s target was set to ${amount} sessions.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-main-ability")?.addEventListener("click", async () => {
    const currentAbility = actor.getFlag(MODULE_ID, "mainAbility") ?? "str";
    const selectedAbility = await askMainAbility(currentAbility);
    if (!selectedAbility) return;

    await actor.setFlag(MODULE_ID, "mainAbility", selectedAbility);

    ui.notifications.info(
      `${actor.name}'s main ability was set to ${ABILITIES[selectedAbility]}.`
    );

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-checkpoint-back")?.addEventListener("click", async () => {
    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const next = getPreviousCheckpoint(current, targetSessions, checkpointCount);

    const confirmBack = await Dialog.confirm({
      title: "Fail Checkpoint",
      content: `
        <p>Did <b>${escapeHtml(actor.name)}</b> fail the checkpoint check?</p>
        <p>Progress will drop from <b>${current}</b> sessions to <b>${next}</b> sessions.</p>
      `,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmBack) return;

    await setSessions(actor, next, targetSessions, checkpointCount);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <b>${escapeHtml(actor.name)}</b> failed the checkpoint check.<br>
        Progress dropped from <b>${current}</b> sessions to <b>${next}</b> sessions.
      `
    });

    ui.notifications.warn(`${actor.name} returned to the previous checkpoint.`);
    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-reset")?.addEventListener("click", async () => {
    const confirmReset = await Dialog.confirm({
      title: "Reset Training",
      content: `<p>Reset training progress for <b>${escapeHtml(actor.name)}</b>?</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmReset) return;

    await setSessions(actor, 0, targetSessions, checkpointCount);
    await renderFeatTrainingTab(sheet, actor, tab);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

})();
