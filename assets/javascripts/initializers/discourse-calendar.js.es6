import { Promise } from "rsvp";
import { isPresent } from "@ember/utils";
import DiscourseURL from "discourse/lib/url";
import { cookAsync } from "discourse/lib/text";
import { escapeExpression } from "discourse/lib/utilities";
import loadScript from "discourse/lib/load-script";
import { withPluginApi } from "discourse/lib/plugin-api";
import { ajax } from "discourse/lib/ajax";
import { hidePopover, showPopover } from "discourse/lib/d-popover";
import Category from "discourse/models/category";

// https://stackoverflow.com/a/16348977
/* eslint-disable */
// prettier-ignore
function stringToHexColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let hex = "#";
  for (let i = 0; i < 3; i++) {
    let value = (hash >> (i * 8)) & 0xff;
    hex += ("00" + value.toString(16)).substr(-2);
  }
  return hex;
}

function loadFullCalendar() {
  return new Promise((resolve) => {
    loadScript(
    "/plugins/discourse-calendar/javascripts/fullcalendar-v5.min.js",
    ).then(() => {
      loadScript("/plugins/discourse-calendar/javascripts/popper.min.js").then(() => {
        resolve();
      });
    });
  });
}


function initializeDiscourseCalendar(api) {
  let _topicController;
  const siteSettings = api.container.lookup("site-settings:main");
  const outletName = siteSettings.calendar_categories_outlet;

  const site = api.container.lookup("site:main");
  const isMobileView = site && site.mobileView;

  let selector = `.${outletName}-outlet`;
  if (outletName === "before-topic-list-body") {
    selector = `.topic-list:not(.shared-drafts) .${outletName}-outlet`;
  }

  // selector = '.dismiss-container-top';
  selector = '.before-topic-list-body-outlet.category-calendar';

  api.onPageChange((url, title) => {
    // const $calendarContainer = $(`${selector}.category-calendar`);
    const $calendarContainer = $(selector);
    if (!$calendarContainer.length) return;
    $calendarContainer.hide();

    const browsedCategory = Category.findBySlugPathWithID(url);
    if (browsedCategory) {
      const settings = siteSettings.calendar_categories
        .split("|")
        .filter(Boolean)
        .map((stringSetting) => {
          const data = {};
          stringSetting
            .split(";")
            .filter(Boolean)
            .forEach((s) => {
              const parts = s.split("=");
              data[parts[0]] = parts[1];
            });
          return data;
        });

      const categorySetting = settings.findBy(
        "categoryId",
        browsedCategory.id.toString()
      );

      // Manage calendar with postId in categorySetting (extension setting)
      if (categorySetting && categorySetting.postId) {
        $calendarContainer.show();
        const postId = categorySetting.postId;
        const $spinner = $(
          '<div class="calendar"><div class="spinner medium"></div></div>'
        );
        $calendarContainer.html($spinner);
        loadFullCalendar().then(() => {
          const options = extractOptionalsCategorySettingOptions([`postId=${postId}`], categorySetting);

          const rawCalendar = `[calendar ${options.join(" ")}]\n[/calendar]`;
          const cookRaw = cookAsync(rawCalendar);
          const loadPost = ajax(`/posts/${postId}.json`);
          Promise.all([cookRaw, loadPost]).then((results) => {
            const cooked = results[0];
            const post = results[1];
            const $cooked = $(cooked.string);
            $calendarContainer.html($cooked);
            render($(".calendar", $cooked), post, siteSettings);
          });
        });
      }

      // Manage calendar with eventsFromCategory in categorySetting (extension setting)
      if (categorySetting && categorySetting.eventsFromCategory) {
        const { eventsFromCategory } = categorySetting;
        // Show container
        $calendarContainer.show();

        // Add a loader
        const $spinner = $(
          '<div class="calendar"><div class="spinner medium"></div></div>'
        );
        $calendarContainer.html($spinner);

        // Load fullcalendar.io script
        loadFullCalendar().then(() => {
            const options = extractOptionalsCategorySettingOptions([`eventsFromCategory=${eventsFromCategory}`], categorySetting);

            const rawCalendar = `[calendar ${options.join(" ")}]\n[/calendar]`;
            // Cooking calendar
            const cookRaw = cookAsync(rawCalendar);
            // Fetch event from category id
            const fetchEvents = ajax(`/discourse-post-event/events.json?category_id=${eventsFromCategory}&include_subcategories=true`);

            // Execute cooking and fetch events
            Promise.all([cookRaw, fetchEvents]).then((results) => {
              const cooked = results[0];
              const { events } = results[1];
              const $cooked = $(cooked.string);

              // Add calendar to DOM
              $calendarContainer.html($cooked);
              renderCalendarFromCategoryEvents($(".calendar", $cooked), events);
            })
        });
      }
    }
  });

  api.decorateCooked(
    ($elem, helper) => attachCalendar($elem, helper, siteSettings),
    {
      onlyStream: true,
      id: "discourse-calendar",
    }
  );

  api.cleanupStream(cleanUp);

  api.registerCustomPostMessageCallback(
    "calendar_change",
    (topicController) => {
      const stream = topicController.get("model.postStream");
      const post = stream.findLoadedPost(stream.get("firstPostId"));
      const $op = $(".topic-post article#post_1");
      const $calendar = $op.find(".calendar").first();

      if (post && $calendar.length > 0) {
        ajax(`/posts/${post.id}.json`).then((post) =>
          loadFullCalendar().then(() => render($calendar, post, siteSettings))
        );
      }
    }
  );


  /**
   * Extract optionals options from categorySetting ("calendar categories" in extension settings)
   *
   * @return array
  */
  function extractOptionalsCategorySettingOptions(options, categorySetting) {
    const optionals = ["weekends", "tzPicker", "defaultView"];

    optionals.forEach((optional) => {
      if (isPresent(categorySetting[optional])) {
        options.push(
          `${optional}=${escapeExpression(categorySetting[optional])}`
        );
      }
    });

    return options;
  }

  /**
   * Render a calendar with event from a category
   *
   * @returns Void
   */
  function renderCalendarFromCategoryEvents($calendar, events) {

      $calendar = $calendar.empty();
      const timezone = _getTimeZone($calendar, api.getCurrentUser());
      // Instantiate fullcalendar.io
      const calendar = _buildCalendar($calendar, timezone);

      calendar.render();
      _setupTimezonePicker(calendar, timezone);

      // Iterate events
      events.forEach(rawEvent => {
        const event = {
          title: rawEvent.name || rawEvent.post.topic.title,
          start: rawEvent.starts_at,
          end: rawEvent.ends_at,
          extendedProps: {
            postNumber: rawEvent.post.post_number,
            postUrl: rawEvent.post.url,
          }
        };

        // Add a events
        calendar.addEvent(event);

      });
  }

  function render($calendar, post, siteSettings) {
    $calendar = $calendar.empty();

    const timezone = _getTimeZone($calendar, api.getCurrentUser());
    const calendar = _buildCalendar($calendar, timezone);
    const staticLines = getStaticLines(post);
    const isStatic = staticLines.length > 0;

    if (isStatic) {
      calendar.render();
      _setStaticCalendarEvents(calendar, $calendar, staticLines);
    } else {
      // Get events from post of the topic
      _setDynamicCalendarEvents(calendar, post, siteSettings);
      calendar.render();
      _setDynamicCalendarOptions(calendar, $calendar);
    }

    _setupTimezonePicker(calendar, timezone);
  }

  function cleanUp() {
    window.removeEventListener("scroll", hidePopover);
  }

  function attachCalendar($elem, helper, siteSettings) {
    window.addEventListener("scroll", hidePopover);

    const $calendar = $(".calendar", $elem);

    if ($calendar.length === 0) {
      return;
    }

    loadFullCalendar().then(() =>
      render($calendar, helper.getModel(), siteSettings)
    );
  }

  function _buildCalendar($calendar, timeZone) {
    let $calendarTitle = document.querySelector(
      ".discourse-calendar-header > .discourse-calendar-title"
    );

    const defaultView = escapeExpression(
      $calendar.attr("data-calendar-default-view") ||
        (isMobileView ? "listNextYear" : "month")
    );

    const showAddToCalendar =
      $calendar.attr("data-calendar-show-add-to-calendar") !== "false";

    const $tooltip        = $('.calendar-tooltip');
    const $tooltipContent = $('.tooltip-content');
    const tooltipNode     = $tooltip[0];

    return new window.FullCalendar.Calendar($calendar[0], {
        timeZone: 'local',
        locale: 'fr',
        displayEventEnd: false,
        height: 725,
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
         },
        weekNumbers: true,
        navLinks: true, // can click day/week names to navigate views
        dayMaxEvents: true, // allow "more" link when too many events
        /*
        datesRender: (info) => {
          if (showAddToCalendar) {
            _insertAddToCalendarLinks(info);
          }

          $calendarTitle.innerText = info.view.title;
        },
        */
        eventMouseEnter: function({event, el}) {
            const { start, end, title } = event;
            const $title                = $('.title', $tooltipContent);
            const $ends                 = $('.ends', $tooltipContent);
            const $endsDate             = $('.date', $ends);
            const $endsTime             = $('.time', $ends);
            const $starts               = $('.starts', $tooltipContent);
            const $startsDate           = $('.date', $starts);
            const $startsTime           = $('.time', $starts);

            const eventnode             = $('.fc-event-title', el)[0];

            $title.html(title);
            $tooltipContent.toggleClass('no-title', !title);

            $startsDate.html(start.toLocaleDateString());
            $startsTime.html(start.toLocaleTimeString());

            $endsDate.html(end ? end.toLocaleDateString() : "");
            $endsTime.html(end ? start.toLocaleTimeString() : "");

            $startsTime.toggle(!event.allDay);

            $tooltipContent.toggleClass('only-first-date', !end);

            $tooltip.show();
            this.tooltip = new window.Popper.createPopper(eventnode, tooltipNode, {
                placement: 'top',
                modifiers: [
                    {
                    name: 'offset',
                    options: {
                        offset: [0, 8],
                    },
                    },
                ],
            });
        },
        eventMouseLeave: function({el}) {
            $tooltip.hide();
            this.tooltip = null;
        },
      });
  }

  function _convertHtmlToDate(html) {
    const date = html.attr("data-date");

    if (!date) {
      return null;
    }

    const time = html.attr("data-time");
    const timezone = html.attr("data-timezone");
    let dateTime = date;

    if (time) {
      dateTime = `${dateTime} ${time}`;
    }

    return {
      weeklyRecurring: html.attr("data-recurring") === "1.weeks",
      dateTime: moment.tz(dateTime, timezone || "Etc/UTC"),
      timeString: time
    };
  }

  function _buildEventObject(from, to) {
    const hasTimeSpecified = (d) => {
      return d.hours() !== 0 || d.minutes() !== 0 || d.seconds() !== 0;
    };

    let event = {
      start: from.dateTime.toDate(),
    };

    if (to) {
      if (hasTimeSpecified(to.dateTime) || hasTimeSpecified(from.dateTime)) {
        event.end = to.dateTime.toDate();
      }
    }
    if (!from.timeString){
      event.allDay = true;
    }

    if (from.weeklyRecurring) {
      event.startTime = {
        hours: from.dateTime.hours(),
        minutes: from.dateTime.minutes(),
        seconds: from.dateTime.seconds(),
      };
      event.daysOfWeek = [from.dateTime.day()];
    }

    return event;
  }

  function getStaticLines(post) {
    const html = $(`<div>${post.cooked}</div>`)
        .find('.calendar p')
        .html();

    if (!html) {
        return [];
    }

    return html.trim().split("<br>");
  }


  function _setStaticCalendarEvents(calendar, $calendar, staticLines) {

    let lastLine = {};
    staticLines.forEach((line, index) => {
        const html = $.parseHTML(line);
        const htmlDates = html.filter((h) =>
          $(h).hasClass("discourse-local-date")
        );
        if (htmlDates.length === 0) {
            lastLine = { line, index };
            return;
        }

        const from = _convertHtmlToDate($(htmlDates[0]));
        const to = _convertHtmlToDate($(htmlDates[1]));

        let event = _buildEventObject(from, to);
        // Add previous line
        event.title = lastLine.index === index -1 ? lastLine.line : "";
        calendar.addEvent(event);
      });
  }

  function _setDynamicCalendarOptions(calendar, $calendar) {
    const skipWeekends = $calendar.attr("data-weekends") === "false";
    const hiddenDays = $calendar.attr("data-hidden-days");

    if (skipWeekends) {
      calendar.setOption("weekends", false);
    }

    if (hiddenDays) {
      calendar.setOption(
        "hiddenDays",
        hiddenDays.split(",").map((d) => parseInt(d))
      );
    }

  }


  function _buildEvent(detail) {
    const event = _buildEventObject(
      detail.from
        ? {
            dateTime: moment(detail.from),
            weeklyRecurring: detail.recurring === "1.weeks",
            timeString: detail.from
          }
        : null,
      detail.to
        ? {
            dateTime: moment(detail.to),
            weeklyRecurring: detail.recurring === "1.weeks",
            timeString: detail.to
          }
        : null
    );

    event.extendedProps = {};
    if (detail.post_url) {
      event.extendedProps.postUrl = detail.post_url;
    } else if (detail.post_number) {
      event.extendedProps.postNumber = detail.post_number;
    } else {
      event.classNames = ["holiday"];
    }

    return event;
  }

  function _addStandaloneEvent(calendar, post, detail, siteSettings) {
    const event = _buildEvent(detail);

    const holidayCalendarTopicId = parseInt(
      siteSettings.holiday_calendar_topic_id,
      10
    );

    const text = detail.message.split("\n").filter((e) => e);
    if (
      text.length &&
      post.topic_id &&
      holidayCalendarTopicId !== post.topic_id
    ) {
      event.title = text[0];
      event.extendedProps.description = text.slice(1).join(" ");
    } else {
      event.title = detail.username;
      event.backgroundColor = stringToHexColor(detail.username);
    }

    let popupText = detail.message.substr(0, 50);
    if (detail.message.length > 50) {
      popupText = popupText + "...";
    }
    event.extendedProps.htmlContent = popupText;
    event.title = event.title.replace(/<img[^>]*>/g, "");
    calendar.addEvent(event);
  }

  function _addGroupedEvent(calendar, post, detail) {
    let htmlContent = "";
    let usernames = [];
    let localEventNames = [];

    Object.keys(detail.localEvents)
      .sort()
      .forEach((key) => {
        const localEvent = detail.localEvents[key];
        htmlContent += `<b>${key}</b>: ${localEvent.usernames
          .sort()
          .join(", ")}<br>`;
        usernames = usernames.concat(localEvent.usernames);
        localEventNames.push(key);
      });

    const event = _buildEvent(detail);
    event.classNames = ["grouped-event"];

    if (usernames.length > 3) {
      event.title = isMobileView
        ? usernames.length
        : `(${usernames.length}) ` + I18n.t("discourse_calendar.holiday");
    } else if (usernames.length === 1) {
      event.title = usernames[0];
    } else {
      event.title = isMobileView
        ? usernames.length
        : `(${usernames.length}) ` + usernames.slice(0, 3).join(", ");
    }

    if (localEventNames.length > 1) {
      event.extendedProps.htmlContent = htmlContent;
    } else {
      if (usernames.length > 1) {
        event.extendedProps.htmlContent = htmlContent;
      } else {
        event.extendedProps.htmlContent = localEventNames[0];
      }
    }

    calendar.addEvent(event);
  }

  // Get event from post of the topic
  function _setDynamicCalendarEvents(calendar, post, siteSettings) {
    const groupedEvents = [];
    // TODO: fix calendar_details detail.from with time 00:00 for a no time defined event in a post
    (post.calendar_details || []).forEach((detail) => {
      switch (detail.type) {
        case "grouped":
          groupedEvents.push(detail);
          break;
        case "standalone":
          _addStandaloneEvent(calendar, post, detail, siteSettings);
          break;
      }
    });

    const formatedGroupedEvents = {};
    groupedEvents.forEach((groupedEvent) => {
      const minDate = moment(groupedEvent.from)
        .utc()
        .startOf("day")
        .toISOString();
      const maxDate = moment(groupedEvent.to || groupedEvent.from)
        .utc()
        .endOf("day")
        .toISOString();

      const identifier = `${minDate}-${maxDate}`;
      formatedGroupedEvents[identifier] = formatedGroupedEvents[identifier] || {
        from: minDate,
        to: maxDate || minDate,
        localEvents: {},
      };

      formatedGroupedEvents[identifier].localEvents[
        groupedEvent.name
      ] = formatedGroupedEvents[identifier].localEvents[groupedEvent.name] || {
        usernames: [],
      };

      formatedGroupedEvents[identifier].localEvents[
        groupedEvent.name
      ].usernames.push.apply(
        formatedGroupedEvents[identifier].localEvents[groupedEvent.name]
          .usernames,
        groupedEvent.usernames
      );
    });

    Object.keys(formatedGroupedEvents).forEach((key) => {
      const formatedGroupedEvent = formatedGroupedEvents[key];
      _addGroupedEvent(calendar, post, formatedGroupedEvent);
    });
  }

  function _getTimeZone($calendar, currentUser) {
    let defaultTimezone = $calendar.attr("data-calendar-default-timezone");
    const isValidDefaultTimezone = !!moment.tz.zone(defaultTimezone);
    if (!isValidDefaultTimezone) {
      defaultTimezone = null;
    }

    return (
      defaultTimezone ||
      (currentUser && currentUser.timezone) ||
      moment.tz.guess()
    );
  }

  function _setupTimezonePicker(calendar, timezone) {
    let $timezonePicker = $(".discourse-calendar-timezone-picker");

    if ($timezonePicker.length) {
      $timezonePicker.on("change", function (event) {
        calendar.setOption("timeZone", event.target.value);
        _insertAddToCalendarLinks(calendar);
      });

      moment.tz.names().forEach((timezone) => {
        $timezonePicker.append(new Option(timezone, timezone));
      });

      $timezonePicker.val(timezone);
    } else {
      $(".discourse-calendar-timezone-wrap").text(timezone);
    }
  }

  function _insertAddToCalendarLinks(info) {
    if (info.view.type !== "listNextYear") return;

    const eventSegments = info.view.eventRenderer.segs;
    const eventSegmentDefMap = _eventSegmentDefMap(info);

    for (const event of eventSegments) {
      _insertAddToCalendarLinkForEvent(event, eventSegmentDefMap);
    }
  }

  function _insertAddToCalendarLinkForEvent(event, eventSegmentDefMap) {
    const eventTitle = event.eventRange.def.title;
    let map = eventSegmentDefMap[event.eventRange.def.defId];
    let startDate = map.start;
    let endDate = map.end;

    endDate = endDate
      ? _formatDateForGoogleApi(endDate, event.eventRange.def.allDay)
      : _endDateForAllDayEvent(startDate, event.eventRange.def.allDay);
    startDate = _formatDateForGoogleApi(startDate, event.eventRange.def.allDay);

    const link = document.createElement("a");
    const title = I18n.t("discourse_calendar.add_to_calendar");
    link.title = title;
    link.appendChild(document.createTextNode(title));
    link.href = `
      http://www.google.com/calendar/event?action=TEMPLATE&text=${encodeURIComponent(
        eventTitle
      )}&dates=${startDate}/${endDate}&details=${encodeURIComponent(
      event.eventRange.def.extendedProps.description
    )}`;
    link.target = "_blank";
    link.classList.add("fc-list-item-add-to-calendar");
    event.el.querySelector(".fc-list-item-title").appendChild(link);
  }

  function _formatDateForGoogleApi(date, allDay = false) {
    if (!allDay) return date.toISOString().replace(/-|:|\.\d\d\d/g, "");

    return moment(date).utc().format("YYYYMMDD");
  }

  function _endDateForAllDayEvent(startDate, allDay) {
    const unit = allDay ? "days" : "hours";
    return _formatDateForGoogleApi(
      moment(startDate).add(1, unit).toDate(),
      allDay
    );
  }

  function _eventSegmentDefMap(info) {
    let map = {};

    for (let event of info.view.calendar.getEvents()) {
      map[event._instance.defId] = { start: event.start, end: event.end };
    }
    return map;
  }
}

export default {
  name: "discourse-calendar",

  initialize(container) {
    const siteSettings = container.lookup("site-settings:main");
    if (siteSettings.calendar_enabled) {
      withPluginApi("0.8.22", initializeDiscourseCalendar);
    }
  },
};
