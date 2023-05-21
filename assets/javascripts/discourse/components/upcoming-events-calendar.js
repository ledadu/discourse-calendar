import Component from "@ember/component";
import { schedule } from "@ember/runloop";
import { Promise } from "rsvp";
import loadScript from "discourse/lib/load-script";
import Category from "discourse/models/category";
import getURL from "discourse-common/lib/get-url";
import { formatEventName } from "../helpers/format-event-name";
import { isNotFullDayEvent } from "../lib/guess-best-date-format";
import { buildPopover, destroyPopover } from "../lib/popover";

export default Component.extend({
  tagName: "",
  events: null,

  init() {
    this._super(...arguments);

    this._calendar = null;
  },

  willDestroyElement() {
    this._super(...arguments);

    this._calendar && this._calendar.destroy();
    this._calendar = null;
  },

  didInsertElement() {
    this._super(...arguments);

    this._renderCalendar();
  },

  addRecurrentEvents(events) {
    events.forEach((event) => {
      event.upcoming_dates?.forEach((upcomingDate) => {
        events.push(
          Object.assign({}, event, {
            starts_at: upcomingDate.starts_at,
            ends_at: upcomingDate.ends_at,
            upcoming_dates: [],
          })
        );
      });
    });

    return events;
  },

  _renderCalendar() {
    const $calendar       = $('.calendar');
    const $tooltip        = $('.calendar-tooltip');
    const $tooltipContent = $('.tooltip-content');

    if (!$calendar.length) {
      return;
    }

    const calendarNode = $calendar[0];
    const tooltipNode = $tooltip[0];
    const showAddToCalendar =
      $calendar.attr("data-calendar-show-add-to-calendar") !== "false";

    $calendar.html('');

    this._loadCalendar().then(() => {
      /*
      const fullCalendar = new window.FullCalendar.Calendar(calendarNode, {
        eventClick: function () {
          destroyPopover();
        },
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
      });
      this._calendar = fullCalendar;

      const tagsColorsMap = JSON.parse(siteSettings.map_events_to_color);

      const originalEventAndRecurrents = this.addRecurrentEvents(
        this.events.content
      );

      (originalEventAndRecurrents || []).forEach((event) => {
        const { starts_at, ends_at, post, category_id } = event;

        let backgroundColor;

        if (post.topic.tags) {
          const tagColorEntry = tagsColorsMap.find(
            (entry) =>
              entry.type === "tag" && post.topic.tags.includes(entry.slug)
          );
          backgroundColor = tagColorEntry?.color;
        }

        if (!backgroundColor) {
          const categoryColorEntry = tagsColorsMap.find(
            (entry) =>
              entry.type === "category" &&
              entry.slug === post.topic.category_slug
          );
          backgroundColor = categoryColorEntry?.color;
        }

        const categoryColor = Category.findById(category_id)?.color;
        if (!backgroundColor && categoryColor) {
          backgroundColor = `#${categoryColor}`;
        }

        let classNames;
        if (moment(ends_at || starts_at).isBefore(moment())) {
          classNames = "fc-past-event";
        }
    */
      this._calendar = new window.FullCalendar.Calendar(calendarNode, {
        timeZone: 'local',
        locale: this.siteSettings.default_locale,
        firstDay: this.siteSettings.default_locale === 'fr' ? 1 : 0,
        displayEventEnd: false,
        height: window.innerHeight - 200,
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
         },
        weekNumbers: true,
        navLinks: true, // can click day/week names to navigate views
        dayMaxEvents: true, // allow "more" link when too many events
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
            this._insertAddToCalendarLinks(info);
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

            const eventNode             = $('.fc-event-title, .fc-list-event-title > a', el)[0];
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

      (this.events || []).forEach((event) => {
        const { starts_at, ends_at, post } = event;
        const { topic } = post;
        const { category_id } = topic;
        const category = Category.findById(category_id);
        // const duration = moment.duration(moment(ends_at).diff(moment(starts_at))).asDays();
        this._calendar.addEvent({
          title: formatEventName(event),
          start: starts_at,
          end: ends_at || starts_at,
          url: getURL(`/t/-/${post.topic.id}/${post.post_number}`),
          color: `#${category.color}`,
          extendedProps: {
            post,
            topic,
            category
          },
        });
      });

      this._calendar.render();
    });
  },

  _insertAddToCalendarLinks(info) {
    if (info.view.type !== "listMonth") return;
    this._insertAddToCalendarLinkForEvent(info);
  },

  _insertAddToCalendarLinkForEvent(info) {
    const { event, el } = info;
    const eventTitle = event.title;
    let startDate = event.start;
    let endDate = event.end;

    endDate = endDate
      ? this._formatDateForGoogleApi(endDate, event.allDay)
      : this._endDateForAllDayEvent(startDate, event.allDay);
    startDate = this._formatDateForGoogleApi(startDate, event.allDay);

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
  },

   _formatDateForGoogleApi(date, allDay = false) {
    if (!allDay) return date.toISOString().replace(/-|:|\.\d\d\d/g, "");

    return moment(date).utc().format("YYYYMMDD");
  },

  _endDateForAllDayEvent(startDate, allDay) {
    const unit = allDay ? "days" : "hours";
    return this._formatDateForGoogleApi(
      moment(startDate).add(1, unit).toDate(),
      allDay
    );
  },

  _loadCalendar() {
    return new Promise((resolve) => {
      loadScript(
        "/plugins/discourse-calendar/javascripts/fullcalendar-v5.min.js",
      ).then(() => {
        loadScript("/plugins/discourse-calendar/javascripts/popper.min.js").then(() => {
            schedule("afterRender", () => {
            if (this.isDestroying || this.isDestroyed) {
                return;
            }

            resolve();
            });
        });
      });
    });
  },
});
