// Poppy's Story Time — app logic. Vanilla JS, no build step, no framework.
// CONTENT comes from data.js (loaded before this file).

(function () {
  "use strict";

  var VALUE_META = {
    honesty: { label: "Honesty" },
    kindness: { label: "Kindness" },
    empathy: { label: "Empathy" },
    persistence: { label: "Persistence" }
  };

  var LOCATION_LABEL = { indoor: "Indoor", outdoor: "Outdoor", both: "Indoor or outdoor" };

  var state = {
    tab: "stories",
    storyFilterValue: "all",
    storyFilterTradition: "all",
    pickValue: "all",
    activityFilterLocation: "all",
    activityFilterSkill: "all",
    booksFilterValue: "all",
    view: { type: "list" }, // list | storyDetail | activityDetail
    storyMode: "full" // full | cue
  };

  var app = document.getElementById("app");

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      if (!seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    });
    out.sort();
    return out;
  }

  function valueBadge(value) {
    var meta = VALUE_META[value] || { label: value };
    return '<span class="badge value-' + escapeHtml(value) + '">' + escapeHtml(meta.label) + "</span>";
  }

  function neutralBadge(text) {
    return '<span class="badge neutral">' + escapeHtml(text) + "</span>";
  }

  // ---------- Navigation ----------

  function setTab(tab) {
    state.tab = tab;
    state.view = { type: "list" };
    render();
    window.scrollTo(0, 0);
  }

  function openStory(id, mode) {
    state.view = { type: "storyDetail", id: id };
    state.storyMode = mode || state.storyMode || "full";
    render();
    window.scrollTo(0, 0);
  }

  function openActivity(id) {
    state.view = { type: "activityDetail", id: id };
    render();
    window.scrollTo(0, 0);
  }

  function backToList() {
    state.view = { type: "list" };
    render();
    window.scrollTo(0, 0);
  }

  // ---------- Render: shell ----------

  function render() {
    var tabsHtml =
      '<nav class="tabs">' +
      tabBtn("stories", "📖 Stories") +
      tabBtn("books", "📚 Books") +
      tabBtn("activities", "🎲 Activities") +
      "</nav>";

    document.getElementById("tabs-slot").innerHTML = tabsHtml;

    var html = "";
    if (state.tab === "stories") {
      html = state.view.type === "storyDetail" ? renderStoryDetail(state.view.id) : renderStoriesList();
    } else if (state.tab === "books") {
      html = renderBooksList();
    } else if (state.tab === "activities") {
      html = state.view.type === "activityDetail" ? renderActivityDetail(state.view.id) : renderActivitiesList();
    }

    app.innerHTML = html;
    bindEvents();
  }

  function tabBtn(tab, label) {
    var active = state.tab === tab ? " active" : "";
    return '<button class="tab-btn' + active + '" data-tab="' + tab + '">' + label + "</button>";
  }

  // ---------- Stories: list ----------

  function filteredStories() {
    return CONTENT.stories.filter(function (s) {
      if (state.storyFilterValue !== "all" && s.primary_value !== state.storyFilterValue) return false;
      if (state.storyFilterTradition !== "all" && s.source_tradition !== state.storyFilterTradition) return false;
      return true;
    });
  }

  function renderStoriesList() {
    var traditions = uniqueSorted(CONTENT.stories.map(function (s) { return s.source_tradition; }));
    var values = ["honesty", "kindness", "empathy", "persistence"];
    var stories = filteredStories();

    var valueChips = '<button class="chip' + (state.storyFilterValue === "all" ? " active" : "") +
      '" data-story-value="all">All</button>' +
      values.map(function (v) {
        var active = state.storyFilterValue === v ? " active" : "";
        return '<button class="chip' + active + '" data-story-value="' + v + '">' + VALUE_META[v].label + "</button>";
      }).join("");

    var traditionOptions = '<option value="all">All traditions</option>' +
      traditions.map(function (t) {
        var sel = state.storyFilterTradition === t ? " selected" : "";
        return '<option value="' + escapeHtml(t) + '"' + sel + ">" + escapeHtml(t) + "</option>";
      }).join("");

    var pickOptions = '<option value="all">Any value</option>' +
      values.map(function (v) {
        var sel = state.pickValue === v ? " selected" : "";
        return '<option value="' + v + '"' + sel + ">" + VALUE_META[v].label + "</option>";
      }).join("");

    var listHtml = stories.length
      ? '<div class="list">' + stories.map(storyCard).join("") + "</div>"
      : '<p class="empty-note">No stories match those filters.</p>';

    return (
      '<div class="pick-card">' +
      '<p class="filter-label" style="margin:0 0 2px;">Pick a story for me</p>' +
      '<div class="pick-row">' +
      '<select id="pick-value-select">' + pickOptions + "</select>" +
      '<button class="btn" id="pick-random-btn">🎲 Pick</button>' +
      "</div>" +
      "</div>" +
      '<div class="filter-card">' +
      '<p class="filter-label">Value</p>' +
      '<div class="chip-row">' + valueChips + "</div>" +
      '<div class="select-row">' +
      '<div class="select-field"><label for="tradition-select">Tradition</label>' +
      '<select id="tradition-select">' + traditionOptions + "</select></div>" +
      "</div>" +
      "</div>" +
      listHtml
    );
  }

  function storyCard(s) {
    return (
      '<button class="card" data-story-id="' + s.id + '">' +
      '<p class="card-title">' + escapeHtml(s.title) + "</p>" +
      '<div class="card-meta">' + valueBadge(s.primary_value) + neutralBadge(s.source_tradition) + "</div>" +
      "</button>"
    );
  }

  function pickRandomStory() {
    var pool = state.pickValue === "all"
      ? CONTENT.stories
      : CONTENT.stories.filter(function (s) { return s.primary_value === state.pickValue; });
    if (!pool.length) return;
    var choice = pool[Math.floor(Math.random() * pool.length)];
    openStory(choice.id, "full");
  }

  // ---------- Stories: detail ----------

  function renderStoryDetail(id) {
    var s = byId(CONTENT.stories, id);
    if (!s) return backHtml() + '<p class="empty-note">Story not found.</p>';

    var cueMode = state.storyMode === "cue";

    var segmented =
      '<div class="segmented">' +
      '<button class="' + (cueMode ? "active" : "") + '" data-story-mode="cue">Memory cue</button>' +
      '<button class="' + (!cueMode ? "active" : "") + '" data-story-mode="full">Full script</button>' +
      "</div>";

    var body;
    if (cueMode) {
      body =
        '<div class="content-card">' +
        "<h3>Memory cue</h3>" +
        '<p class="cue-line">' + escapeHtml(s.memory_cue) + "</p>" +
        "<h3>Repeat phrase</h3>" +
        '<p class="repeat-phrase">“' + escapeHtml(s.repeat_phrase) + '”</p>' +
        "</div>";
    } else {
      body =
        '<div class="content-card">' +
        '<div class="script-text">' + escapeHtml(s.script) + "</div>" +
        '<div class="talk-prompt"><h4>Talk about it</h4><p>' + escapeHtml(s.talk_prompt) + "</p></div>" +
        (s.optional_poppy_version
          ? '<div class="poppy-version"><h4>Give Poppy a part</h4><p>' + escapeHtml(s.optional_poppy_version) + "</p></div>"
          : "") +
        "</div>";
    }

    var linkedActivities = CONTENT.activities.filter(function (a) { return a.linked_story_id === s.id; });
    var themeBooks = CONTENT.books.filter(function (b) { return b.primary_value === s.primary_value; });

    var activitiesHtml = "";
    if (linkedActivities.length) {
      activitiesHtml =
        '<p class="section-heading">Try it out</p>' +
        '<div class="list">' + linkedActivities.map(activityCard).join("") + "</div>";
    }

    var booksHtml = "";
    if (themeBooks.length) {
      booksHtml =
        '<p class="section-heading">If you want a book on this theme</p>' +
        themeBooks.map(bookMini).join("");
    }

    return (
      backHtml() +
      '<div class="detail-header">' +
      '<div class="card-meta">' + valueBadge(s.primary_value) + neutralBadge(s.source_tradition) + "</div>" +
      '<h2 class="detail-title">' + escapeHtml(s.title) + "</h2>" +
      "</div>" +
      segmented +
      body +
      activitiesHtml +
      booksHtml
    );
  }

  function bookMini(b) {
    return (
      '<div class="book-mini">' +
      '<p class="title">' + escapeHtml(b.title) + "</p>" +
      '<p class="author">' + escapeHtml(b.author) + "</p>" +
      '<p class="why">' + escapeHtml(b.why) + "</p>" +
      "</div>"
    );
  }

  function backHtml() {
    return '<div class="back-row"><button class="btn ghost" id="back-btn">← Back</button></div>';
  }

  // ---------- Books ----------

  function renderBooksList() {
    var values = ["honesty", "kindness", "empathy", "persistence"];
    var books = CONTENT.books.filter(function (b) {
      return state.booksFilterValue === "all" || b.primary_value === state.booksFilterValue;
    });

    var valueChips = '<button class="chip' + (state.booksFilterValue === "all" ? " active" : "") +
      '" data-book-value="all">All</button>' +
      values.map(function (v) {
        var active = state.booksFilterValue === v ? " active" : "";
        return '<button class="chip' + active + '" data-book-value="' + v + '">' + VALUE_META[v].label + "</button>";
      }).join("");

    var listHtml = books.length
      ? books.map(function (b) {
          return (
            '<div class="book-mini">' +
            '<div class="card-meta" style="margin-bottom:6px;">' + valueBadge(b.primary_value) + "</div>" +
            '<p class="title">' + escapeHtml(b.title) + "</p>" +
            '<p class="author">' + escapeHtml(b.author) + (b.publisher ? " · " + escapeHtml(b.publisher) : "") + "</p>" +
            '<p class="why">' + escapeHtml(b.why) + "</p>" +
            "</div>"
          );
        }).join("")
      : '<p class="empty-note">No books match that filter.</p>';

    return (
      '<div class="filter-card">' +
      '<p class="filter-label">Value</p>' +
      '<div class="chip-row">' + valueChips + "</div>" +
      "</div>" +
      listHtml
    );
  }

  // ---------- Activities: list ----------

  function filteredActivities() {
    return CONTENT.activities.filter(function (a) {
      if (state.activityFilterLocation !== "all" && a.location !== state.activityFilterLocation) return false;
      if (state.activityFilterSkill !== "all" && a.skill !== state.activityFilterSkill) return false;
      return true;
    });
  }

  function renderActivitiesList() {
    var skills = uniqueSorted(CONTENT.activities.map(function (a) { return a.skill; }));
    var activities = filteredActivities();

    var locations = ["indoor", "outdoor", "both"];
    var locationChips = '<button class="chip' + (state.activityFilterLocation === "all" ? " active" : "") +
      '" data-activity-location="all">All</button>' +
      locations.map(function (loc) {
        var active = state.activityFilterLocation === loc ? " active" : "";
        return '<button class="chip' + active + '" data-activity-location="' + loc + '">' + LOCATION_LABEL[loc] + "</button>";
      }).join("");

    var skillOptions = '<option value="all">All skills</option>' +
      skills.map(function (sk) {
        var sel = state.activityFilterSkill === sk ? " selected" : "";
        return '<option value="' + escapeHtml(sk) + '"' + sel + ">" + escapeHtml(capitalize(sk)) + "</option>";
      }).join("");

    var listHtml = activities.length
      ? '<div class="list">' + activities.map(activityCard).join("") + "</div>"
      : '<p class="empty-note">No activities match those filters.</p>';

    return (
      '<div class="filter-card">' +
      '<p class="filter-label">Location</p>' +
      '<div class="chip-row">' + locationChips + "</div>" +
      '<div class="select-row">' +
      '<div class="select-field"><label for="skill-select">Skill</label>' +
      '<select id="skill-select">' + skillOptions + "</select></div>" +
      "</div>" +
      "</div>" +
      listHtml
    );
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function activityCard(a) {
    return (
      '<button class="card" data-activity-id="' + a.id + '">' +
      '<p class="card-title">' + escapeHtml(a.name) + "</p>" +
      '<div class="card-meta">' +
      neutralBadge(LOCATION_LABEL[a.location] || a.location) +
      neutralBadge(capitalize(a.skill)) +
      neutralBadge(a.duration_minutes + " min") +
      "</div>" +
      "</button>"
    );
  }

  // ---------- Activities: detail ----------

  function renderActivityDetail(id) {
    var a = byId(CONTENT.activities, id);
    if (!a) return backHtml() + '<p class="empty-note">Activity not found.</p>';

    var linkedStory = a.linked_story_id ? byId(CONTENT.stories, a.linked_story_id) : null;

    var materialsHtml = a.materials && a.materials.length
      ? "<h3>What you need</h3><ul class=\"materials-list\">" +
        a.materials.map(function (m) { return "<li>" + escapeHtml(m) + "</li>"; }).join("") +
        "</ul>"
      : "";

    var stepsHtml = a.steps && a.steps.length
      ? "<h3>Steps</h3><ol class=\"steps-list\">" +
        a.steps.map(function (st) { return "<li>" + escapeHtml(st) + "</li>"; }).join("") +
        "</ol>"
      : "";

    var safetyHtml = a.safety_note
      ? '<div class="safety-note"><span class="icon">⚠️</span><span class="text">' + escapeHtml(a.safety_note) + "</span></div>"
      : "";

    var linkedStoryHtml = linkedStory
      ? '<div class="linked-story-link"><button class="btn secondary block" data-story-id="' + linkedStory.id + '">📖 Goes with: ' + escapeHtml(linkedStory.title) + "</button></div>"
      : "";

    return (
      backHtml() +
      '<div class="detail-header">' +
      '<div class="card-meta">' +
      neutralBadge(LOCATION_LABEL[a.location] || a.location) +
      neutralBadge(capitalize(a.skill)) +
      neutralBadge(a.duration_minutes + " min") +
      "</div>" +
      '<h2 class="detail-title">' + escapeHtml(a.name) + "</h2>" +
      "</div>" +
      '<div class="content-card">' +
      materialsHtml +
      stepsHtml +
      safetyHtml +
      linkedStoryHtml +
      "</div>"
    );
  }

  // ---------- Events ----------

  function bindEvents() {
    var backBtn = document.getElementById("back-btn");
    if (backBtn) backBtn.addEventListener("click", backToList);

    var pickBtn = document.getElementById("pick-random-btn");
    if (pickBtn) pickBtn.addEventListener("click", pickRandomStory);

    var pickSelect = document.getElementById("pick-value-select");
    if (pickSelect) {
      pickSelect.addEventListener("change", function (e) {
        state.pickValue = e.target.value;
      });
    }

    var traditionSelect = document.getElementById("tradition-select");
    if (traditionSelect) {
      traditionSelect.addEventListener("change", function (e) {
        state.storyFilterTradition = e.target.value;
        render();
      });
    }

    var skillSelect = document.getElementById("skill-select");
    if (skillSelect) {
      skillSelect.addEventListener("change", function (e) {
        state.activityFilterSkill = e.target.value;
        render();
      });
    }

    app.querySelectorAll("[data-story-value]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.storyFilterValue = el.getAttribute("data-story-value");
        render();
      });
    });

    app.querySelectorAll("[data-book-value]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.booksFilterValue = el.getAttribute("data-book-value");
        render();
      });
    });

    app.querySelectorAll("[data-activity-location]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.activityFilterLocation = el.getAttribute("data-activity-location");
        render();
      });
    });

    app.querySelectorAll("[data-story-mode]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.storyMode = el.getAttribute("data-story-mode");
        render();
      });
    });

    app.querySelectorAll("[data-story-id]").forEach(function (el) {
      el.addEventListener("click", function () {
        openStory(el.getAttribute("data-story-id"), "full");
      });
    });

    app.querySelectorAll("[data-activity-id]").forEach(function (el) {
      el.addEventListener("click", function () {
        openActivity(el.getAttribute("data-activity-id"));
      });
    });
  }

  // Tab buttons are rewritten on every render, so delegate the click from a
  // stable ancestor (document) instead of rebinding listeners each time.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-tab]") : null;
    if (btn) setTab(btn.getAttribute("data-tab"));
  });

  render();
})();
