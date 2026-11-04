import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  LESSONS,
  questionFor,
  quizCount,
  readProgress,
  writeProgress,
  type Lesson,
  type LessonProgress,
} from "../lib/lessons";
import { PlayingCard } from "../components/PlayingCard/PlayingCard";
import "./TrainPage.css";

/**
 * /train: the Train tab. The hub lists the lessons, the Drill (a full-screen
 * game at /drill, unchanged) and what's coming; `?lesson=<id>` plays one
 * lesson. The lesson lives in the query string so the tab bar's "last place
 * in each tab" memory returns to it.
 */
export function TrainPage() {
  const [params, setParams] = useSearchParams();
  const lesson = LESSONS.find((l) => l.id === params.get("lesson"));
  if (lesson) {
    return <LessonPlayer key={lesson.id} lesson={lesson} onExit={() => setParams({}, { replace: false })} />;
  }
  return <TrainHub onOpen={(id) => setParams({ lesson: id })} />;
}

function TrainHub({ onOpen }: { onOpen: (id: string) => void }) {
  // Read once per visit to the hub: finishing a lesson remounts it.
  const [progress] = useState(readProgress);
  return (
    <div className="train">
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

function LessonPlayer({ lesson, onExit }: { lesson: Lesson; onExit: () => void }) {
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
      writeProgress(lesson.id, finished);
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
          <button type="button" className="train__primary" onClick={onExit}>
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
