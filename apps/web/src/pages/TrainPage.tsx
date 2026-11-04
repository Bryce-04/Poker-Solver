import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  LESSONS,
  questionFor,
  recommendNext,
  quizCount,
  type Lesson,
  type LessonProgress,
} from "../lib/lessons";
import { PlayingCard } from "../components/PlayingCard/PlayingCard";
import { putProgress } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isPracticeFilter, type PracticeFilter } from "../lib/practiceTable";
import { readProgress, syncProgress, writeProgress } from "../lib/progress";
import { CoachPanel } from "./train/CoachPanel";
import { PracticeTable } from "./train/PracticeTable";
import "./TrainPage.css";

/**
 * /train: the Train tab. The hub lists the lessons, the Drill (a full-screen
 * game at /drill, unchanged) and what's coming; `?lesson=<id>` plays one
 * lesson. The lesson lives in the query string so the tab bar's "last place
 * in each tab" memory returns to it.
 */
export function TrainPage() {
  const [params, setParams] = useSearchParams();
  const auth = useAuth();
  // Progress is kept per account on this device and, when signed in, on the
  // server too (lib/progress.ts). Keyed by account so a sign-in or an account
  // switch starts the screen fresh.
  const account = auth.status === "signed-in" ? (auth.email ?? "account") : null;
  const practice = params.get("practice");
  if (isPracticeFilter(practice)) {
    return (
      <PracticeTable
        filter={practice}
        onFilter={(f) => setParams({ practice: f }, { replace: true })}
        onExit={() => setParams({}, { replace: false })}
      />
    );
  }
  const lesson = LESSONS.find((l) => l.id === params.get("lesson"));
  if (lesson) {
    return (
      <LessonPlayer
        key={`${account}:${lesson.id}`}
        lesson={lesson}
        account={account}
        onExit={() => setParams({}, { replace: false })}
        onPractice={(f) => setParams({ practice: f })}
      />
    );
  }
  return (
    <TrainHub
      key={account ?? "guest"}
      account={account}
      onOpen={(id) => setParams({ lesson: id })}
      onPractice={() => setParams({ practice: "all" })}
    />
  );
}

function TrainHub({
  account,
  onOpen,
  onPractice,
}: {
  account: string | null;
  onOpen: (id: string) => void;
  onPractice: () => void;
}) {
  // This device's copy now; the account's server copy replaces it once synced.
  const [progress, setProgress] = useState(() => readProgress(account));
  useEffect(() => {
    if (account === null) return;
    let cancelled = false;
    void syncProgress(account).then((merged) => {
      if (!cancelled) setProgress(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);
  const next = recommendNext(progress);
  return (
    <div className="train">
      <section aria-label="Up next">
        <div className="train__next">
          <p className="train__coach-title">Up next</p>
          <p className="train__next-text">{next.message}</p>
          {next.kind === "finished" ? (
            <Link to="/drill" className="train__primary train__primary--link">
              Open the Drill
            </Link>
          ) : (
            <button type="button" className="train__primary" onClick={() => onOpen(next.lessonId)}>
              {next.kind === "start" ? "Start" : "Try again"}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="train-lessons">
        <h2 id="train-lessons" className="train__heading">
          Lessons
        </h2>
        <p className="train__hint">Start here if you know the hand rankings. Each lesson is a few short cards and some questions.</p>
        <ul className="train__list">
          {LESSONS.map((lesson) => {
            const p = progress[lesson.id];
            return (
              <li key={lesson.id}>
                <button type="button" className="train__card" onClick={() => onOpen(lesson.id)}>
                  <span className="train__card-main">
                    <span className="train__card-title">{lesson.title}</span>
                    <span className="train__card-sub">{lesson.summary}</span>
                    <span className="train__card-meta">
                      {lesson.minutes} min
                      {p?.done ? ` · done, ${p.correct}/${p.total} right` : ""}
                    </span>
                  </span>
                  <span className="train__chevron" aria-hidden="true">
                    {p?.done ? "✓" : "›"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="train-practice">
        <h2 id="train-practice" className="train__heading">
          Practice
        </h2>
        <button type="button" className="train__card" onClick={onPractice}>
          <span className="train__card-main">
            <span className="train__card-title">6-max practice table</span>
            <span className="train__card-sub">
              Play preflop hands at a full table: the bots follow the charts and every decision of yours is graded.
            </span>
          </span>
          <span className="train__chevron" aria-hidden="true">
            ›
          </span>
        </button>
        <Link to="/drill" className="train__card">
          <span className="train__card-main">
            <span className="train__card-title">Drill</span>
            <span className="train__card-sub">Play flop spots against the solver and see how your choices compare. Full screen.</span>
          </span>
          <span className="train__chevron" aria-hidden="true">
            ›
          </span>
        </Link>
      </section>

      <section aria-labelledby="train-soon">
        <h2 id="train-soon" className="train__heading">
          Coming soon
        </h2>
        <ul className="train__list">
          <li className="train__card train__card--soon">
            <span className="train__card-main">
              <span className="train__card-title">Ranked play</span>
              <span className="train__card-sub">Play hands, earn chips and find your level.</span>
            </span>
          </li>
          <li className="train__card train__card--soon">
            <span className="train__card-main">
              <span className="train__card-title">Playing different opponents</span>
              <span className="train__card-sub">How to adjust against tight, loose, passive and aggressive players.</span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}

type Result = LessonProgress;

function LessonPlayer({
  lesson,
  account,
  onExit,
  onPractice,
}: {
  lesson: Lesson;
  account: string | null;
  onExit: () => void;
  onPractice: (filter: PracticeFilter) => void;
}) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const total = quizCount(lesson);
  const step = lesson.steps[index];
  const question = questionFor(step);
  const last = index === lesson.steps.length - 1;

  function next(nowCorrect: number) {
    if (last) {
      const finished = { done: true, correct: nowCorrect, total };
      const stored = writeProgress(lesson.id, finished, account);
      // Signed in: also send it to the account. Fire and forget; if it fails
      // (offline) the next sync uploads it, because the device copy is newer.
      if (account !== null) void putProgress(lesson.id, stored);
      setResult(finished);
      return;
    }
    setIndex(index + 1);
    setPicked(null);
  }

  function answer(choiceIndex: number) {
    if (!question || picked !== null) return;
    setPicked(choiceIndex);
    if (question.choices[choiceIndex].correct) setCorrect((c) => c + 1);
  }

  if (result) {
    return (
      <div className="train">
        <h2 className="train__heading">{lesson.title}: finished</h2>
        <p className="train__result">
          You got {result.correct} of {result.total} questions right.
        </p>
        <p className="train__hint">
          {result.correct === result.total
            ? "That's all of them. Ready for the next lesson."
            : "Worth another go if any of those felt shaky. The explanations stay the same, and so does the rule."}
        </p>
        <div className="train__actions">
          {lesson.practice && (
            <button type="button" className="train__primary" onClick={() => onPractice(lesson.practice!)}>
              Practice this at the table
            </button>
          )}
          <button type="button" className={lesson.practice ? "train__chip" : "train__primary"} onClick={onExit}>
            Back to lessons
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="train">
      <div className="train__bar">
        <button type="button" className="train__back" onClick={onExit}>
          ← All lessons
        </button>
        <span className="train__progress">
          {index + 1} of {lesson.steps.length}
        </span>
      </div>
      <progress className="train__meter" max={lesson.steps.length} value={index + 1} aria-label="Lesson progress" />

      {step.kind === "read" ? (
        <article className="train__panel">
          <h2 className="train__heading">{step.title}</h2>
          {step.body.map((paragraph) => (
            <p key={paragraph} className="train__text">
              {paragraph}
            </p>
          ))}
          <div className="train__actions">
            <button type="button" className="train__primary" onClick={() => next(correct)}>
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </article>
      ) : (
        question && (
        <article className="train__panel">
          <h2 className="train__heading">{question.prompt}</h2>
          {question.board && (
            <div className="train__hand" aria-label="The flop">
              {question.board.map((card) => (
                <PlayingCard key={card} card={card} size="md" />
              ))}
            </div>
          )}
          {question.cards && (
            <div className="train__hand" aria-label="Your hand">
              <PlayingCard card={question.cards[0]} size="lg" />
              <PlayingCard card={question.cards[1]} size="lg" />
            </div>
          )}
          <ul className="train__choices">
            {question.choices.map((choice, i) => {
              const state =
                picked === null ? "" : choice.correct ? "correct" : i === picked ? "wrong" : "";
              return (
                <li key={choice.label}>
                  <button
                    type="button"
                    className="train__choice"
                    data-state={state || undefined}
                    disabled={picked !== null}
                    aria-pressed={picked === i}
                    onClick={() => answer(i)}
                  >
                    {choice.label}
                  </button>
                </li>
              );
            })}
          </ul>
          {picked !== null && (
            <div className="train__feedback" role="status">
              <p className="train__feedback-title">{question.choices[picked].correct ? "Right." : "Not quite."}</p>
              <p className="train__text">{question.choices[picked].why}</p>
              {!question.choices[picked].correct && (
                <p className="train__text">
                  <strong>Answer:</strong> {question.choices.find((c) => c.correct)?.label}.
                </p>
              )}
              <CoachPanel
                key={index}
                context={{
                  lesson_title: lesson.title,
                  prompt: question.prompt,
                  board: question.board ?? [],
                  hand: question.cards ? [...question.cards] : [],
                  picked: question.choices[picked].label,
                  correct: question.choices.find((c) => c.correct)?.label ?? "",
                  explanation: question.choices[picked].why,
                }}
              />
              <div className="train__actions">
                <button type="button" className="train__primary" onClick={() => next(correct)} autoFocus>
                  {last ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          )}
        </article>
        )
      )}
    </div>
  );
}
