import { isPresent } from "@ember/utils";
import $ from "jquery";
import { Promise } from "rsvp";
import { ajax } from "discourse/lib/ajax";
import loadScript from "discourse/lib/load-script";
import { withPluginApi } from "discourse/lib/plugin-api";
import { cook } from "discourse/lib/text";
import DiscourseURL from "discourse/lib/url";
import { escapeExpression } from "discourse/lib/utilities";
import Category from "discourse/models/category";
import getURL from "discourse-common/lib/get-url";
import { iconHTML } from "discourse-common/lib/icon-library";
import I18n from "I18n";
import { formatEventName } from "../helpers/format-event-name";
import { colorToHex, contrastColor, stringToColor } from "../lib/colors";
import { isNotFullDayEvent } from "../lib/guess-best-date-format";
import { buildPopover, destroyPopover } from "../lib/popover";

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

function getCurrentBcp47Locale() {
  return I18n.currentLocale().replace("_", "-");
}

function getCalendarButtonsText() {
  return {
    today: I18n.t("discourse_calendar.toolbar_button.today"),
    month: I18n.t("discourse_calendar.toolbar_button.month"),
    week: I18n.t("discourse_calendar.toolbar_button.week"),
    day: I18n.t("discourse_calendar.toolbar_button.day"),
    list: I18n.t("discourse_calendar.toolbar_button.list"),
  };
}

function initializeDiscourseCalendar(api) {
  const siteSettings = api.container.lookup("service:site-settings");

  if (siteSettings.login_required && !api.getCurrentUser()) {
    return;
  }

  let enableTimezoneOffset = siteSettings.default_timezone_offset_user_option;

  let _topicController;
  const outletName = siteSettings.calendar_categories_outlet;

  const site = api.container.lookup("service:site");
  const isMobileView = site && site.mobileView;

  const selector = outletName;

  api.onPageChange((url, title) => {
    const $selector = $(selector);
    if (!$selector.length) return;

    if ($(`${selector} > .category-calendar`).length === 0) {
        $selector.prepend('<div class="category-calendar"></div>');
    }
    const $calendarContainer = $(`${selector} > .category-calendar`);

    $calendarContainer.hide();

    const browsedCategory = Category.findBySlugPathWithID(url.split("?")[0]);
    if (!browsedCategory) {
      return;
    }

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

    /*
      loadFullCalendar().then(() => {
        const options = [`postId=${postId}`];

        const optionals = ["weekends", "tzPicker", "defaultView"];
        optionals.forEach((optional) => {
          if (isPresent(categorySetting[optional])) {
            options.push(
              `${optional}=${escapeExpression(categorySetting[optional])}`
            );
          }
        });

        const rawCalendar = `[calendar ${options.join(" ")}]\n[/calendar]`;
        const cookRaw = cook(rawCalendar);
        const loadPost = ajax(`/posts/${postId}.json`);
        Promise.all([cookRaw, loadPost]).then((results) => {
          const cooked = results[0];
          const post = results[1];
          categoryCalendarNode.innerHTML = cooked.toString();
          render($(".calendar"), post);
        });
      });
    } else {
      if (!categoryEventNode) {
        return;
      }

      const eventSettings = siteSettings.events_calendar_categories.split("|");
      const foundCategory = eventSettings.find(
        (k) => k === browsedCategory.id.toString()
      );

      if (foundCategory) {
        loadFullCalendar().then(() => {
          let fullCalendar = new window.FullCalendar.Calendar(
            categoryEventNode,
            {
              eventClick: function () {
                destroyPopover();
              },
              locale: getCurrentBcp47Locale(),
              buttonText: getCalendarButtonsText(),
              eventPositioned: (info) => {
                if (siteSettings.events_max_rows === 0) {
                  return;
                }

                let fcContent = info.el.querySelector(".fc-content");
                let computedStyle = window.getComputedStyle(fcContent);
                let lineHeight = parseInt(computedStyle.lineHeight, 10);

                if (lineHeight === 0) {
                  lineHeight = 20;
                }
                let maxHeight = lineHeight * siteSettings.events_max_rows;

                if (fcContent) {
                  fcContent.style.maxHeight = `${maxHeight}px`;
                }

                let fcTitle = info.el.querySelector(".fc-title");
                if (fcTitle) {
                  fcTitle.style.overflow = "hidden";
                  fcTitle.style.whiteSpace = "pre-wrap";
                }
                fullCalendar.updateSize();
              },
              eventMouseEnter: function ({ event, jsEvent }) {
                destroyPopover();
                const htmlContent = event.title;
                buildPopover(jsEvent, htmlContent);
              },
              eventMouseLeave: function () {
                destroyPopover();
              },
            }
          );
          const params = {
            category_id: browsedCategory.id,
            include_subcategories: true,
          };
          if (siteSettings.include_expired_events_on_calendar) {
            params.include_expired = true;
          }
          const loadEvents = ajax(`/discourse-post-event/events`, {
            data: params,
          });

          Promise.all([loadEvents]).then((results) => {
            const events = results[0];

            const tagsColorsMap = JSON.parse(siteSettings.map_events_to_color);

            events[Object.keys(events)[0]].forEach((event) => {
              const { starts_at, ends_at, post, category_id } = event;

              let backgroundColor;

              if (post.topic.tags) {
                const tagColorEntry = tagsColorsMap.find(
                  (entry) =>
                    entry.type === "tag" && post.topic.tags.includes(entry.slug)
                );
                backgroundColor = tagColorEntry ? tagColorEntry.color : null;
              }

              if (!backgroundColor) {
                const categoryColorFromMap = tagsColorsMap.find(
                  (entry) =>
                    entry.type === "category" &&
                    entry.slug === post.topic.category_slug
                )?.color;
                backgroundColor =
                  categoryColorFromMap ||
                  `#${Category.findById(category_id)?.color}`;
              }

              let classNames;
              if (moment(ends_at || starts_at).isBefore(moment())) {
                classNames = "fc-past-event";
              }

              fullCalendar.addEvent({
                title: formatEventName(event),
                start: starts_at,
                end: ends_at || starts_at,
                allDay: !isNotFullDayEvent(moment(starts_at), moment(ends_at)),
                url: getURL(`/t/-/${post.topic.id}/${post.post_number}`),
                backgroundColor,
                classNames,
              });
        */
        events[Object.keys(events)[0]].forEach((event) => {
            const { starts_at, ends_at, post } = event;
            calendar.addEvent({
            title: formatEventName(event),
            start: starts_at,
            end: ends_at || starts_at,
            allDay: !isNotFullDayEvent(moment(starts_at), moment(ends_at)),
            url: getURL(`/t/-/${post.topic.id}/${post.post_number}`),
            });
        });

        calendar.render();
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
  });

  api.decorateCooked(($elem, helper) => attachCalendar($elem, helper), {
    onlyStream: true,
    id: "discourse-calendar",
  });

  api.registerCustomPostMessageCallback(
    "calendar_change",
    (topicController) => {
      const stream = topicController.get("model.postStream");
      const post = stream.findLoadedPost(stream.get("firstPostId"));
      const $op = $(".topic-post article#post_1");
      const $calendar = $op.find(".calendar").first();

      if (post && $calendar.length > 0) {
        ajax(`/posts/${post.id}.json`).then(() =>
          loadFullCalendar().then(() => render($calendar, post))
        );
      }
    }
  );

  if (api.registerNotificationTypeRenderer) {
    api.registerNotificationTypeRenderer(
      "event_reminder",
      (NotificationTypeBase) => {
        return class extends NotificationTypeBase {
          get linkTitle() {
            if (this.notification.data.title) {
              return I18n.t(this.notification.data.title);
            } else {
              return super.linkTitle;
            }
          }

          get icon() {
            return "calendar-day";
          }

          get label() {
            return I18n.t(this.notification.data.message);
          }

          get description() {
            return this.notification.data.topic_title;
          }
        };
      }
    );
    api.registerNotificationTypeRenderer(
      "event_invitation",
      (NotificationTypeBase) => {
        return class extends NotificationTypeBase {
          get icon() {
            return "calendar-day";
          }

          get label() {
            if (
              this.notification.data.message ===
              "discourse_calendar.discourse_post_event.notifications.invite_user_predefined_attendance_notification"
            ) {
              return I18n.t(this.notification.data.message, {
                username: this.username,
              });
            }
            return super.label;
          }

          get description() {
            return this.notification.data.topic_title;
          }
        };
      }
    );
  }

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
        const { post } = rawEvent;
        const { topic } = post;
        const { category_id } = topic;
        const category = Category.findById(category_id);
        const event = {
          title: formatEventName(rawEvent),
          start: rawEvent.starts_at,
          end: rawEvent.ends_at,
          extendedProps: {
            post,
            topic,
            category
          },
          url: rawEvent.post.url,
          color: `#${category.color}`
        };

        // Add a events
        calendar.addEvent(event);

      });
  }

  function render($calendar, post, siteSettings) {
    $calendar = $calendar.empty();

    const timezone = _getTimeZone($calendar, api.getCurrentUser());
    const calendar = _buildCalendar($calendar, timezone);
    const isStatic = $calendar.attr("data-calendar-type") === "static";
    const fullDay = $calendar.attr("data-calendar-full-day") === "true";
    const staticLines = getStaticLines(post);
    // const isStatic = staticLines.length > 0;

    if (isStatic) {
      calendar.render();
      _setStaticCalendarEvents(calendar, $calendar, staticLines);
    } else {
      _setDynamicCalendarEvents(calendar, post, fullDay, timezone, siteSettings);
      calendar.render();
      _setDynamicCalendarOptions(calendar, $calendar);
    }

    const resetDynamicEvents = () => {
      const selectedTimezone = calendar.getOption("timeZone");
      calendar.getEvents().forEach((event) => event.remove());
      _setDynamicCalendarEvents(calendar, post, fullDay, selectedTimezone);
    };

    _setupTimezonePicker(calendar, timezone, resetDynamicEvents);

    if (siteSettings.enable_timezone_offset_for_calendar_events) {
      _setupTimezoneOffsetButton(resetDynamicEvents);
    }
  }

  function attachCalendar($elem, helper) {
    const $calendar = $(".calendar", $elem);

    if ($calendar.length === 0) {
      return;
    }

    loadFullCalendar().then(() => render($calendar, helper.getModel()));
  }

  function _buildCalendar($calendar, timeZone) {
    let $calendarTitle = document.querySelector(
      ".discourse-calendar-header > .discourse-calendar-title"
    );

    const showAddToCalendar =
      $calendar.attr("data-calendar-show-add-to-calendar") !== "false";

   /*
    return new window.FullCalendar.Calendar($calendar[0], {
      timeZone,
      timeZoneImpl: "moment-timezone",
      locale: getCurrentBcp47Locale(),
      buttonText: getCalendarButtonsText(),
      nextDayThreshold: "06:00:00",
      displayEventEnd: true,
      height: 650,
      firstDay: 1,
      defaultView,
      views: {
        listNextYear: {
          type: "list",
          duration: { days: 365 },
          buttonText: "list",
          listDayFormat: {
            month: "long",
            year: "numeric",
            day: "numeric",
            weekday: "long",
          },
        },
      },
      header: {
        left: "prev,next today",
        center: "title",
        right: "month,basicWeek,listNextYear",
      },
      eventOrder: ["start", _orderByTz, "-duration", "allDay", "title"],
      datesRender: (info) => {
        if (showAddToCalendar) {
          _insertAddToCalendarLinks(info);
        }

        $calendarTitle.innerText = info.view.title;
      },

      eventPositioned: (info) => {
        _setTimezoneOffset(info);
      },
    });
    */

    const $tooltip        = $('.calendar-tooltip');
    const $tooltipContent = $('.tooltip-content');
    const tooltipNode     = $tooltip[0];

    return new window.FullCalendar.Calendar($calendar[0], {
        timeZone: 'local',
        locale: siteSettings.default_locale,
        firstDay: siteSettings.default_locale === 'fr' ? 1 : 0,
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
        initialView: isMobileView ? "listMonth" : "dayGridMonth",

        eventDidMount: (info) => {
          const { el } = info;
          const  timeNode = el.querySelector('.fc-event-time');
          const dotNode = el.querySelector('.fc-daygrid-event-dot');
          const { style } = dotNode || el;
          const { borderColor } = style || {};
          if (borderColor) {
            timeNode.style.backgroundColor = borderColor;
          }
          if (showAddToCalendar) {
            _insertAddToCalendarLinks(info);
          }

          // $calendarTitle.innerText = info.view.title;
        },

        eventMouseEnter: function({event, el}) {
            const {
                start, end, title, backgroundColor, extendedProps
            }                 = event;
            const $category   = $('.category', $tooltipContent);
            const $title      = $('.title', $tooltipContent);
            const $ends       = $('.ends', $tooltipContent);
            const $endsDate   = $('.date', $ends);
            const $endsTime   = $('.time', $ends);
            const $starts     = $('.starts', $tooltipContent);
            const $startsDate = $('.date', $starts);
            const $startsTime = $('.time', $starts);

            const eventNode   = $('.fc-event-title, .fc-list-event-title > a', el)[0];

            const { category } = extendedProps;

            if (category) {
                $category.html(category.name);
            }

            $title.html(title);
            $tooltipContent.toggleClass('no-title', !title);

            $startsDate.html(start.toLocaleDateString());
            $startsTime.html(start.toLocaleTimeString());

            $endsDate.html(end ? end.toLocaleDateString() : "");
            $endsTime.html(end ? end.toLocaleTimeString() : "");

            $startsTime.toggle(!event.allDay);

            $tooltipContent.toggleClass('only-first-date', !end);

            $tooltip.show();
            this.tooltip = new window.Popper.createPopper(eventNode, tooltipNode, {
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
            tooltipNode.style.backgroundColor = backgroundColor;
        },
        eventMouseLeave: function({el}) {
            $tooltip.hide();
            this.tooltip = null;
        },
      });
  }

  function _orderByTz(a, b) {
    if (
      !siteSettings.enable_timezone_offset_for_calendar_events &&
      !enableTimezoneOffset
    ) {
      return 0;
    }

    const offsetA = a.extendedProps.timezoneOffset;
    const offsetB = b.extendedProps.timezoneOffset;

    return offsetA === offsetB ? 0 : offsetA < offsetB ? -1 : 1;
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
      if (!d) {
        return false;
      }
      return d.hours() !== 0 || d.minutes() !== 0 || d.seconds() !== 0;
    };

    const hasTime =
      hasTimeSpecified(to?.dateTime) || hasTimeSpecified(from?.dateTime);
    const dateFormat = hasTime ? "YYYY-MM-DD HH:mm:ssZ" : "YYYY-MM-DD";

    let event = {
      start: from.dateTime.format(dateFormat),
      allDay: false,
    };

    if (to) {
      if (hasTime) {
        event.end = to.dateTime.format(dateFormat);
      } else {
        event.end = to.dateTime.add(1, "days").format(dateFormat);
        event.allDay = true;
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
        hiddenDays.split(",").map((d) => parseInt(d, 10))
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

    if (detail.timezoneOffset) {
      event.extendedProps.timezoneOffset = detail.timezoneOffset;
    }

    return event;
  }

  function _addStandaloneEvent(calendar, post, detail) {
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
      const color = stringToColor(detail.username);

      event.title = detail.username;
      event.backgroundColor = colorToHex(color);
      event.textColor = contrastColor(color);
    }

    let popupText = detail.message.slice(0, 100);
    if (detail.message.length > 100) {
      popupText += "…";
    }
    event.extendedProps.htmlContent = popupText;
    event.title = event.title.replace(/<img[^>]*>/g, "");
    calendar.addEvent(event);
  }

  function _addGroupedEvent(calendar, post, detail, fullDay, calendarTz) {
    const groupedEventData =
      siteSettings.enable_timezone_offset_for_calendar_events &&
      enableTimezoneOffset &&
      fullDay
        ? _splitGroupEventByTimezone(detail, calendarTz)
        : [detail];

    groupedEventData.forEach((eventData) => {
      let htmlContent = "";
      let users = [];
      let localEventNames = [];

      Object.keys(eventData.localEvents)
        .sort()
        .forEach((key) => {
          const localEvent = eventData.localEvents[key];
          htmlContent += `<b>${key}</b>: ${localEvent.users
            .map((u) => u.username)
            .sort()
            .join(", ")}<br>`;
          users = users.concat(localEvent.users);
          localEventNames.push(key);
        });

      const event = _buildEvent(eventData);
      event.classNames = ["grouped-event"];

      if (users.length > 2) {
        event.title = `(${users.length}) ${localEventNames[0]}`;
      } else if (users.length === 1) {
        event.title = users[0].username;
      } else {
        event.title = isMobileView
          ? `(${users.length}) ${localEventNames[0]}`
          : `(${users.length}) ` + users.map((u) => u.username).join(", ");
      }

      if (localEventNames.length > 1) {
        event.extendedProps.htmlContent = htmlContent;
      } else {
        if (users.length > 1) {
          event.extendedProps.htmlContent = htmlContent;
        } else {
          event.extendedProps.htmlContent = localEventNames[0];
        }
      }

      calendar.addEvent(event);
    });
  }


  function _splitGroupEventByTimezone(detail, calendarTz) {
    const calendarUtcOffset = moment.tz(calendarTz).utcOffset();
    let timezonesOffsets = [];
    let splittedEvents = [];

    Object.values(detail.localEvents).forEach((event) => {
      event.users.forEach((user) => {
        const userUtcOffset = moment.tz(user.timezone).utcOffset();
        const timezoneOffset = (calendarUtcOffset - userUtcOffset) / 60;
        user.timezoneOffset = timezoneOffset;
        timezonesOffsets.push(timezoneOffset);
      });
    });

    [...new Set(timezonesOffsets)].forEach((offset, i) => {
      let filteredLocalEvents = {};
      let eventTimezones = [];

      Object.keys(detail.localEvents).forEach((key) => {
        const threshold =
          siteSettings.split_grouped_events_by_timezone_threshold;

        const filtered = detail.localEvents[key].users.filter(
          (u) =>
            Math.abs(u.timezoneOffset - (offset + threshold * i)) <= threshold
        );
        if (filtered.length > 0) {
          filteredLocalEvents[key] = {
            users: filtered,
          };
          filtered.forEach((u) => {
            detail.localEvents[key].users.splice(
              detail.localEvents[key].users.findIndex(
                (e) => e.username === u.username
              ),
              1
            );
            if (
              !eventTimezones.find((t) => t.timezoneOffset === u.timezoneOffset)
            ) {
              eventTimezones.push({
                timezone: u.timezone,
                timezoneOffset: u.timezoneOffset,
              });
            }
          });
        }
      });

      if (Object.keys(filteredLocalEvents).length > 0) {
        const eventTimezone = _findAverageTimezone(eventTimezones);

        let from = moment.tz(detail.from, eventTimezone.timezone);
        let to = moment.tz(detail.to, eventTimezone.timezone);

        _modifyDatesForTimezoneOffset(from, to, eventTimezone.timezoneOffset);

        splittedEvents.push({
          timezoneOffset: eventTimezone.timezoneOffset,
          localEvents: filteredLocalEvents,
          from: from.format("YYYY-MM-DD"),
          to: to.format("YYYY-MM-DD"),
        });
      }
    });

    return splittedEvents;
  }

  function _findAverageTimezone(eventTimezones) {
    const totalOffsets = eventTimezones.reduce(
      (sum, timezone) => sum + timezone.timezoneOffset,
      0
    );
    const averageOffset = totalOffsets / eventTimezones.length;

    return eventTimezones.reduce((closest, timezone) => {
      const difference = Math.abs(timezone.timezoneOffset - averageOffset);
      return difference < Math.abs(closest.timezoneOffset - averageOffset)
        ? timezone
        : closest;
    });
  }

  function _setDynamicCalendarEvents(calendar, post, fullDay, calendarTz, siteSettings) {
    const groupedEvents = [];
    const calendarUtcOffset = moment.tz(calendarTz).utcOffset();

    (post.calendar_details || []).forEach((detail) => {
      switch (detail.type) {
        case "grouped":
          if (fullDay && detail.timezone) {
            detail.from = moment
              .tz(detail.from, detail.timezone)
              .format("YYYY-MM-DD");
          }
          groupedEvents.push(detail);
          break;
        case "standalone":
          if (fullDay && detail.timezone) {
            const eventDetail = { ...detail };
            let from = moment.tz(detail.from, detail.timezone);
            let to = moment.tz(detail.to, detail.timezone);

            if (
              siteSettings.enable_timezone_offset_for_calendar_events &&
              enableTimezoneOffset
            ) {
              const eventUtcOffset = moment.tz(detail.timezone).utcOffset();
              const timezoneOffset = (calendarUtcOffset - eventUtcOffset) / 60;
              eventDetail.timezoneOffset = timezoneOffset;

              _modifyDatesForTimezoneOffset(from, to, timezoneOffset);
            }
            eventDetail.from = from.format("YYYY-MM-DD");
            eventDetail.to = to.format("YYYY-MM-DD");

            _addStandaloneEvent(calendar, post, eventDetail);
          } else {
            _addStandaloneEvent(calendar, post, detail);
          }
          break;
      }
    });

    const formattedGroupedEvents = {};
    groupedEvents.forEach((groupedEvent) => {
      const minDate = fullDay
        ? moment(groupedEvent.from).format("YYYY-MM-DD")
        : moment(groupedEvent.from).utc().startOf("day").toISOString();
      const maxDate = fullDay
        ? moment(groupedEvent.to || groupedEvent.from).format("YYYY-MM-DD")
        : moment(groupedEvent.to || groupedEvent.from)
            .utc()
            .endOf("day")
            .toISOString();

      const identifier = `${minDate}-${maxDate}`;
      formattedGroupedEvents[identifier] = formattedGroupedEvents[
        identifier
      ] || {
        from: minDate,
        to: maxDate || minDate,
        localEvents: {},
      };

      formattedGroupedEvents[identifier].localEvents[groupedEvent.name] =
        formattedGroupedEvents[identifier].localEvents[groupedEvent.name] || {
          users: [],
        };

      formattedGroupedEvents[identifier].localEvents[
        groupedEvent.name
      ].users.push.apply(
        formattedGroupedEvents[identifier].localEvents[groupedEvent.name].users,
        groupedEvent.users
      );
    });

    Object.keys(formattedGroupedEvents).forEach((key) => {
      const formattedGroupedEvent = formattedGroupedEvents[key];
      _addGroupedEvent(
        calendar,
        post,
        formattedGroupedEvent,
        fullDay,
        calendarTz
      );
    });
  }

  function _modifyDatesForTimezoneOffset(from, to, timezoneOffset) {
    if (timezoneOffset > 0) {
      if (to.isValid()) {
        to.add(1, "day");
      } else {
        to = from.clone().add(1, "day");
      }
    } else if (timezoneOffset < 0) {
      if (!to.isValid()) {
        to = from.clone();
      }
      from.subtract(1, "day");
    }
  }

  function _getTimeZone($calendar, currentUser) {
    let defaultTimezone = $calendar.attr("data-calendar-default-timezone");
    const isValidDefaultTimezone = !!moment.tz.zone(defaultTimezone);
    if (!isValidDefaultTimezone) {
      defaultTimezone = null;
    }

    return defaultTimezone || currentUser?.timezone || moment.tz.guess();
  }

  function _setupTimezonePicker(calendar, timezone, resetDynamicEvents) {
    const tzPicker = document.querySelector(
      ".discourse-calendar-timezone-picker"
    );
    if (tzPicker) {
      tzPicker.addEventListener("change", function (event) {
        calendar.setOption("timeZone", event.target.value);
        if (enableTimezoneOffset) {
          resetDynamicEvents();
          _insertAddToCalendarLinks(calendar);
        }
      });

      moment.tz
        .names()
        .filter((t) => !t.startsWith("Etc/GMT"))
        .forEach((tz) => {
          tzPicker.appendChild(new Option(tz, tz));
        });

      tzPicker.value = timezone;
    } else {
      document.querySelector(".discourse-calendar-timezone-wrap").innerText =
        timezone;
    }
  }

  function _setupTimezoneOffsetButton(resetDynamicEvents) {
    const timezoneWrapper = document.querySelector(
      ".discourse-calendar-timezone-wrap"
    );
    const timezoneButton = document.createElement("button");

    timezoneButton.title = I18n.t(
      "discourse_calendar.toggle_timezone_offset_title"
    );
    timezoneButton.classList.add(
      "timezone-offset-button",
      "btn",
      "btn-default",
      "btn-icon",
      "no-text"
    );
    timezoneButton.innerHTML = iconHTML("globe");
    timezoneWrapper.appendChild(timezoneButton);

    timezoneButton.addEventListener("click", () => {
      enableTimezoneOffset = !enableTimezoneOffset;
      resetDynamicEvents();
      timezoneButton.blur();
    });
  }

  function _insertAddToCalendarLinks(info) {
    if (info.view.type !== "listNextYear") {
      return;
    }

/* new add !?
    const eventSegments = info.view.eventRenderer.segs;
    const eventSegmentDefMap = _eventSegmentDefMap(info);

    for (const event of eventSegments) {
      _insertAddToCalendarLinkForEvent(event, eventSegmentDefMap);
    }
*/
    if (info.view.type !== "listMonth") return;
    _insertAddToCalendarLinkForEvent(info);
  }


/*
  function _setTimezoneOffset(info) {
    if (
      !siteSettings.enable_timezone_offset_for_calendar_events ||
      !enableTimezoneOffset ||
      info.view.type === "listNextYear"
    ) {
      return;
    }

    // The timezone offset works by calculating the hour difference
    // between a target event and the calendar event. This is used to
    // determine whether to add an extra day before or after the event.
    // Then, it applies inline styling to resize the event to its
    // original size while adjusting it to the respective timezone.

    const timezoneOffset = info.event.extendedProps.timezoneOffset;
    const segmentDuration = info.el.parentNode?.colSpan;

    const basePctOffset = 100 / segmentDuration;
    // Base margin required to shrink down the event by one day
    const basePxOffset = 5.5 - segmentDuration;
    // Default space between two consecutive events
    // 5.5px = ( ( ( 2px margin + 3px padding ) * 2 ) + 1px border ) / 2

    // K factors are used to adjust each side of the event based on the hour difference
    // A '2' is added to the pxOffset to account for the default margin

    if (timezoneOffset > 0) {
      // When the event extends into the next day
      if (info.isStart) {
        const leftK = Math.abs(timezoneOffset) / 24;
        const pctOffset = `${basePctOffset * leftK}%`;
        const pxOffset = `${basePxOffset * leftK + 2}px`;
        info.el.style.marginLeft = `calc(${pctOffset} + ${pxOffset})`;
      }
      if (info.isEnd) {
        const rightK = (24 - Math.abs(timezoneOffset)) / 24;
        const pctOffset = `${basePctOffset * rightK}%`;
        const pxOffset = `${basePxOffset * rightK + 2}px`;
        info.el.style.marginRight = `calc(${pctOffset} + ${pxOffset})`;
      }
    } else if (timezoneOffset < 0) {
      // When the event starts on the previous day
      if (info.isStart) {
        const leftK = (24 - Math.abs(timezoneOffset)) / 24;
        const pctOffset = `${basePctOffset * leftK}%`;
        const pxOffset = `${basePxOffset * leftK + 2}px`;
        info.el.style.marginLeft = `calc(${pctOffset} + ${pxOffset})`;
      }
      if (info.isEnd) {
        const rightK = Math.abs(timezoneOffset) / 24;
        const pctOffset = `${basePctOffset * rightK}%`;
        const pxOffset = `${basePxOffset * rightK + 2}px`;
        info.el.style.marginRight = `calc(${pctOffset} + ${pxOffset})`;
      }
    }
  }

  function _insertAddToCalendarLinkForEvent(event, eventSegmentDefMap) {
    const eventTitle = event.eventRange.def.title;
    let map = eventSegmentDefMap[event.eventRange.def.defId];
    let startDate = map.start;
    let endDate = map.end;
    */

  function _insertAddToCalendarLinkForEvent(info) {
    const { event, el } = info;
    const eventTitle = event.title;
    let startDate = event.start;
    let endDate = event.end;

    endDate = endDate
      ? _formatDateForGoogleApi(endDate, event.allDay)
      : _endDateForAllDayEvent(startDate, event.allDay);
    startDate = _formatDateForGoogleApi(startDate, event.allDay);

    const link = document.createElement("a");
    const title = I18n.t("discourse_calendar.add_to_calendar");
    link.title = title;
    link.appendChild(document.createTextNode(title));
    link.href = `
      http://www.google.com/calendar/event?action=TEMPLATE&text=${encodeURIComponent(
        eventTitle
      )}&dates=${startDate}/${endDate}&details=${encodeURIComponent(
      event.extendedProps.description
    )}`;
    link.target = "_blank";
    link.classList.add("fc-list-item-add-to-calendar");
    const rowNode = el.closest('.fc-list-event').previousSibling;
    el.querySelector(".fc-list-event-title").appendChild(link);
    el.onclick  = (e) => {
        e.stopPropagation();
    }
  }

  function _formatDateForGoogleApi(date, allDay = false) {
    if (!allDay) {
      return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
    }

    return moment(date).utc().format("YYYYMMDD");
  }

  function _endDateForAllDayEvent(startDate, allDay) {
    const unit = allDay ? "days" : "hours";
    return _formatDateForGoogleApi(
      moment(startDate).add(1, unit).toDate(),
      allDay
    );
  }

}

export default {
  name: "discourse-calendar",

  initialize(container) {
    const siteSettings = container.lookup("service:site-settings");
    if (siteSettings.calendar_enabled) {
      withPluginApi("0.8.22", initializeDiscourseCalendar);
    }
  },
};
