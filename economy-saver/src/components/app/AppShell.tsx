"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { resetDismissals } from "@/components/know/dismissals";
import { PERSONAS, type PersonaId } from "@/lib/sample/personas";
import { ActivityTab } from "./Activity";
import { AddMenu } from "./AddMenu";
import { AppProvider, type App } from "./AppContext";
import { CardsTab } from "./Cards";
import { GetPaid } from "./GetPaid";
import { formatter } from "./format";
import { Nav } from "./Nav";
import { Plan } from "./Plan";
import styles from "./AppShell.module.css";
import { initialState, reducer, stageOf } from "./state";
import { tabLabel, useTab, type TabId } from "./tabs";
import { toCheck } from "./toCheck";
import { Toast, useToast } from "./Toast";
import { Today } from "./Today";
import { TopBar } from "./TopBar";
import { useReducedMotion } from "./useReducedMotion";

export function AppShell() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const { money, runId, opened, trip } = state;
  const persona = PERSONAS[state.personaId];
  const fmt = useMemo(() => formatter(money.homeCurrency), [money.homeCurrency]);
  const reduced = useReducedMotion();
  const toast = useToast();
  const [tab, setTab] = useTab();
  const frame = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const tripTimers = useRef<number[]>([]);

  // Pauses in the scripted demo are cut to 0.3 seconds for people who asked for less motion.
  const delay = useCallback((ms: number) => (reduced ? Math.min(ms, 300) : ms), [reduced]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const clearTimers = useCallback(() => {
    [...timers.current, ...tripTimers.current].forEach((t) => window.clearTimeout(t));
    timers.current = [];
    tripTimers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Open a tab, and optionally bring one of its cards into view once it has drawn.
  const go = useCallback(
    (to: TabId, scrollTo?: string) => {
      setTab(to);
      if (scrollTo) {
        later(() => document.getElementById(scrollTo)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), 80);
      }
    },
    [setTab, later, reduced],
  );

  // A new tab starts at its top, when the person had scrolled past it.
  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    const el = content.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "auto", block: "start" });
  }, [tab]);

  const approve = useCallback(() => {
    dispatch({ type: "approve" });
    later(() => dispatch({ type: "sent" }), delay(1100));
  }, [later, delay]);

  // Back to the opening state for the current person: money, stage, activity, opened moments
  // and every "Not now" / "Never for this". The open tab stays.
  const reset = useCallback(() => {
    clearTimers();
    resetDismissals();
    dispatch({ type: "reset" });
  }, [clearTimers]);

  const switchPerson = useCallback(
    (id: PersonaId) => {
      clearTimers();
      resetDismissals();
      dispatch({ type: "persona", id });
    },
    [clearTimers],
  );

  // Play the demo: the bill is confirmed, the invoice approved and sent, the client pays. It all happens on Today.
  const play = useCallback(() => {
    if (state.playing) return;
    clearTimers();
    resetDismissals();
    dispatch({ type: "reset" });
    dispatch({ type: "playing", value: true });
    setTab("today");
    frame.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    let t = delay(1500);
    later(() => dispatch({ type: "confirm" }), t);
    t += delay(2600);
    later(approve, t);
    t += delay(1100) + delay(2200);
    later(() => {
      dispatch({ type: "paid" });
      dispatch({ type: "playing", value: false });
    }, t);
  }, [state.playing, clearTimers, delay, later, approve, reduced, setTab]);

  // The travel demo: card-use emails arrive one by one, about a second apart (0.3 seconds with reduced motion). The charges land on Cards.
  const startTrip = useCallback(() => {
    tripTimers.current.forEach((t) => window.clearTimeout(t));
    tripTimers.current = [];
    dispatch({ type: "tripStart" });
    setTab("cards");
    persona.demo.trip.charges.forEach((_, index) => {
      tripTimers.current.push(window.setTimeout(() => dispatch({ type: "chargeArrives", index }), delay(500) + index * delay(1000)));
    });
  }, [persona, delay, setTab]);

  const openStatement = useCallback(() => {
    if (!opened.includes("statement")) setTab("cards");
    dispatch({ type: "toggleMoment", moment: "statement" });
  }, [opened, setTab]);

  // Scroll the charge moment into view when the first charge of a trip arrives.
  const sawTrip = useRef(0);
  useEffect(() => {
    if (trip.length === 1 && sawTrip.current === 0) {
      requestAnimationFrame(() => document.getElementById("moment-charge")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" }));
    }
    sawTrip.current = trip.length;
  }, [trip, reduced]);

  // Scroll a newly opened demo moment into view.
  const seen = useRef(0);
  useEffect(() => {
    if (opened.length > seen.current) {
      const last = opened[opened.length - 1];
      requestAnimationFrame(() => document.getElementById(`moment-${last}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" }));
    }
    seen.current = opened.length;
  }, [opened, reduced]);

  const stage = stageOf(money, persona);
  const check = useMemo(() => toCheck(money, persona), [money, persona]);

  const app: App = {
    state,
    persona,
    profile: persona.profile,
    money,
    fmt,
    stage,
    check,
    tab,
    dispatch,
    toast: toast.show,
    go,
    approve,
    play,
    reset,
    startTrip,
    openStatement,
    switchPerson,
    reduced,
  };

  return (
    <AppProvider value={app}>
      <section className={styles.app} ref={frame} aria-label="Economy Saver">
        <TopBar key={runId} />
        <div className={styles.body}>
          <aside className={styles.side}>
            <div className={styles.sideInner}>
              <AddMenu placement="side" />
              <Nav placement="side" />
            </div>
          </aside>
          <div className={styles.content} ref={content}>
            <h2 className={styles.title}>{tabLabel(tab)}</h2>
            {tab === "today" && <Today />}
            {tab === "plan" && <Plan />}
            {tab === "cards" && <CardsTab />}
            {tab === "paid" && <GetPaid />}
            {tab === "activity" && <ActivityTab />}
          </div>
        </div>
        <Nav placement="bottom" />
      </section>

      <Toast message={toast.message} visible={toast.visible} />
    </AppProvider>
  );
}
