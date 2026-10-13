(() => {

const MODULE_ID = "feat-training";
const DEFAULT_TARGET_SESSIONS = 320;
const DEFAULT_CHECKPOINT_COUNT = 10;
const DEFAULT_TRAINING_NAME = "Feat Training Tracker";
const HOURS_PER_SESSION = 4;
const TAB_ID = "feat-training";
const CHECKPOINT_DC = 15;
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

function isAtCheckpoint(sessions, targetSessions, checkpointCount) {
  return getCheckpointSessions(targetSessions, checkpointCount).includes(sessions);
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
  const mod = actor.system?.abilities?.[ability]?.mod ?? 0;

  const roll = await new Roll(`1d20 + ${mod}`).evaluate();
  const total = roll.total;
  const success = total >= CHECKPOINT_DC;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <h3>Training Checkpoint</h3>
      <p><b>Result:</b>
      ${
        success
          ? `<span style="color:green;">SUCCESS</span>`
          : `<span style="color:red;">FAILURE</span>`
      }
      </p>
    `
  });

  if (!success) {
    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const previousCheckpoint = getPreviousCheckpoint(current, targetSessions, checkpointCount);

    await actor.setFlag(MODULE_ID, "sessions", previousCheckpoint);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <b>${escapeHtml(actor.name)}</b> failed the checkpoint check.<br>
        Progress dropped from <b>${current}</b> sessions to <b>${previousCheckpoint}</b> sessions.
      `
    });

    ui.notifications.warn(`${actor.name} failed the checkpoint check and returned to the previous checkpoint.`);
  } else {
    ui.notifications.info(`${actor.name} passed the checkpoint check.`);
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
  const checkpointReady = isAtCheckpoint(sessions, targetSessions, checkpointCount);

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
              <p><b>Checkpoint DC:</b> ${CHECKPOINT_DC}</p>
              ${checkpointReady ? `<p><b>Checkpoint:</b> Check available.</p>` : ""}
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

    if (!isAtCheckpoint(currentSessions, targetSessions, checkpointCount)) {
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

    await actor.setFlag(MODULE_ID, "checkpointCount", amount);

    ui.notifications.info(`${actor.name}'s checkpoint count was set to ${amount}.`);
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
    const next = Math.min(current + amount, targetSessions);

    await actor.setFlag(MODULE_ID, "sessions", next);

    if (next >= targetSessions) {
      ui.notifications.info(`${actor.name} completed training.`);
    }

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-subtract-custom")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("How many sessions should be removed?", 1);
    if (amount === null) return;

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    const next = Math.max(current - amount, 0);
    const removed = current - next;

    await actor.setFlag(MODULE_ID, "sessions", next);
    ui.notifications.info(`${removed} sessions were removed from ${actor.name}.`);

    await renderFeatTrainingTab(sheet, actor, tab);
  });

  tab.querySelector(".feat-training-target")?.addEventListener("click", async () => {
    const amount = await askSessionAmount("New target session count", targetSessions);
    if (amount === null) return;

    await actor.setFlag(MODULE_ID, "targetSessions", amount);

    const current = actor.getFlag(MODULE_ID, "sessions") ?? 0;
    if (current > amount) {
      await actor.setFlag(MODULE_ID, "sessions", amount);
    }

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

    await actor.setFlag(MODULE_ID, "sessions", next);

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

    await actor.setFlag(MODULE_ID, "sessions", 0);
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
