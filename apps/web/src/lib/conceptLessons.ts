import type { Choice, Lesson } from "./lessons";

// Lessons written by hand about ideas the solver data in this app does not (yet) grade: squeezing,
// and adjusting to opponents' tendencies. They are principles, not solver output, and say so on their
// first card. They need a poker-literate reviewer before they are relied on: nothing checks them.

const right = (label: string, why: string): Choice => ({ label, correct: true, why });
const wrong = (label: string, why: string): Choice => ({ label, why });

const NOT_GRADED =
  "This lesson isn't graded against a chart or the solver like the others: the app has no solver-built squeeze ranges yet. The answers are standard principles, not solver output.";

export const CONCEPT_LESSONS: Lesson[] = [
  {
    id: "squeeze",
    group: "Beyond the baseline",
    title: "The squeeze",
    summary: "A 3-bet over an open and a caller: why it works, how big, and when not to.",
    minutes: 6,
    steps: [
      {
        kind: "read",
        title: "What a squeeze is",
        body: [
          'A squeeze is a 3-bet made after someone has opened and at least one other player has called. For example: the cutoff opens to 2.5bb, the button calls, and you re-raise from the blinds.',
          "It is different from a normal 3-bet because there is more money in the pot and more players who have to give up their hands.",
          NOT_GRADED,
        ],
      },
      {
        kind: "read",
        title: "Why it works",
        body: [
          "Dead money: an open of 2.5bb, a call of 2.5bb and the blinds put about 6.5bb in the middle before you raise. Winning that much is worth risking a lot for, so a squeeze needs fewer folds to make money.",
          "The caller is usually weaker: a player who only called did not 3-bet, so their hand is rarely among the very strongest. Calling ranges are weaker and more bunched together than opening ranges, so they fold more often to a big re-raise.",
        ],
      },
      {
        kind: "read",
        title: "How big, and with what",
        body: [
          "Squeeze bigger than a normal 3-bet. A common guide is about four times the open when you are in position, a little more out of position, and one more open-size for each extra caller. Against a 2.5bb open and one caller that is roughly 10bb in position and 12bb or more out of position. A small raise would let the caller see a flop at a good price.",
          "For value, use the hands you would 3-bet strongly anyway (the top pairs and the strongest ace-high hands). For bluffs, prefer hands that block your opponents' best hands and still play reasonably when called, such as suited aces like A5s. Weak offsuit hands make poor bluffs: no blockers, and they play badly if called.",
        ],
      },
      {
        kind: "read",
        title: "Against real players",
        body: [
          "A squeeze works best against an opener who opens a lot and folds to 3-bets, with a caller whose range is weak. It works worst against a very tight opener (their range is strong), against a player who never folds, or when a caller might be slow-playing a monster.",
          "Adjust to what you have actually seen, not just to a chart. See \"Playing against tendencies\".",
        ],
      },
      {
        kind: "quiz",
        prompt: "What makes a squeeze different from a normal 3-bet?",
        choices: [
          right("There is a caller as well as the opener, so there is more money to win and two players who must give up.", "That is the definition: a 3-bet over an open and one or more callers."),
          wrong("It is always a bluff.", "A squeeze can be for value or a bluff; the strongest hands squeeze too."),
          wrong("It is made before anyone has opened.", "A raise before anyone has opened is just an open."),
        ],
      },
      {
        kind: "quiz",
        prompt: "One player opens to 2.5bb, another calls 2.5bb, and the blinds are 0.5bb and 1bb. How much is in the pot before your squeeze?",
        choices: [
          wrong("5bb", "That leaves out the blinds: 2.5 + 2.5 + 0.5 + 1 is more than 5."),
          right("6.5bb", "2.5 + 2.5 + 0.5 + 1 = 6.5bb. That dead money is a big part of why a squeeze is profitable."),
          wrong("9bb", "9bb would be the size of a normal 3-bet, not what is already in the pot."),
        ],
      },
      {
        kind: "quiz",
        prompt: "Why make a squeeze bigger than a normal 3-bet?",
        choices: [
          right("The caller already has a good price to see a flop, so a small raise lets them continue cheaply; a bigger one makes them pay.", "The extra money in the pot gives the caller a good price, so the raise has to be larger to charge them properly."),
          wrong("Because a squeeze always has the best hand.", "A squeeze is often a bluff. The size is about price, not strength."),
          wrong("So the opener is forced to fold.", "Size can't force a fold; it sets the price everyone has to pay."),
        ],
      },
      {
        kind: "quiz",
        prompt: "Which situation is best for a squeeze?",
        choices: [
          right("A loose opener who folds to 3-bets, with a caller whose range is weak.", "Both players are likely to give up, and the dead money is yours when they do."),
          wrong("A very tight player opens under the gun and another player calls.", "A tight opener's range is strong, so the squeeze runs into hands that continue."),
          wrong("Nobody has opened yet.", "Without an open and a caller it isn't a squeeze."),
        ],
      },
      {
        kind: "quiz",
        prompt: "You squeeze as a bluff with A5s. What makes it a better bluff than 72o?",
        choices: [
          right("The ace blocks some of the strongest hands your opponents could continue with, and A5s plays reasonably if you are called.", "Blockers reduce the chance you run into a monster, and playability gives you something to fall back on."),
          wrong("Suited hands never lose.", "Suited hands lose often; suitedness adds only a little equity."),
          wrong("A5s is always the best hand.", "It usually isn't. It is a bluff because of blockers and playability, not strength."),
        ],
      },
    ],
  },
  {
    id: "tendencies",
    group: "Beyond the baseline",
    title: "Playing against tendencies",
    summary: "The solver's play is a baseline, not a rule: how to adjust to the player in front of you.",
    minutes: 5,
    steps: [
      {
        kind: "read",
        title: "A baseline, not a rule",
        body: [
          "The solver and the charts in this app describe how to play against an opponent who also plays perfectly. That is a strong default: it can't be exploited. But very few people play perfectly, and the best play against a specific player is often different from the baseline.",
          "Think of the baseline as where you start, and a player's tendencies as the reasons to leave it.",
          "This lesson isn't graded against the solver: the app doesn't solve for specific opponent types yet. The answers are standard principles, not solver output.",
        ],
      },
      {
        kind: "read",
        title: "Common tendencies and the adjustment",
        body: [
          "Folds too much to 3-bets: 3-bet them more often, and bluff more when you do.",
          "Calls too much and rarely folds: bet your good hands for value more often and bigger, and bluff less, because bluffs don't work on someone who doesn't fold.",
          "Bets and raises too much: call down lighter with your medium-strength hands and let them bluff into you.",
          "Plays too tight and only bets with strong hands: respect their bets and fold more to their aggression, and steal their blinds more often.",
        ],
      },
      {
        kind: "read",
        title: "Be careful with a read",
        body: [
          "Adjust from what you have actually seen, not from one hand: a handful of hands proves very little. A big adjustment is a bet that you have read them right; if you are wrong, or they change, you can do worse than the baseline would have.",
          "Start with small adjustments and add more as the evidence builds. And remember that the ranges in this app are themselves approximate.",
        ],
      },
      {
        kind: "quiz",
        prompt: "Why can't you just copy the solver's strategy against every player?",
        choices: [
          right("It assumes the opponent also plays perfectly. Against someone with a weakness, a different play wins more.", "The solver strategy can't be beaten by a perfect opponent, but it isn't the most profitable play against a weak one."),
          wrong("The solver is usually wrong.", "The baseline is a sound default; the point is that it can be improved on against a specific player."),
          wrong("Solver strategies change every hand.", "They don't; they are a fixed balanced strategy for a given spot."),
        ],
      },
      {
        kind: "quiz",
        prompt: "An opponent folds to almost every 3-bet. What is the best adjustment?",
        choices: [
          right("3-bet them more often, including more bluffs.", "If they fold almost every time, each 3-bet wins the pot without a fight."),
          wrong("3-bet them only with aces.", "That wins less: against someone who folds, you don't need a strong hand."),
          wrong("Stop opening against them.", "You'd be giving up chips for no reason: they are the player you want to attack."),
        ],
      },
      {
        kind: "quiz",
        prompt: "An opponent calls with almost any hand and rarely folds. What is the best adjustment?",
        choices: [
          right("Bet your good hands for value more often and bluff less.", "They pay off your strong hands and don't fold to bluffs, so value is worth more and bluffing is worth less."),
          wrong("Bluff more often.", "Bluffs only work when the other player folds."),
          wrong("Fold your good hands.", "Good hands are what win against a player who calls too much."),
        ],
      },
      {
        kind: "quiz",
        prompt: "You have seen an opponent bluff the river in several hands. You hold a medium-strength hand and they bet. What should you lean toward?",
        choices: [
          right("Calling more often than the baseline would suggest.", "If they bluff more than a balanced player, more of your medium hands beat what they are betting."),
          wrong("Always folding.", "That is the baseline against a tight bettor; it ignores what you have seen."),
          wrong("Raising with the medium hand.", "A raise turns a bluff-catcher into a bluff and folds out the bluffs you wanted to beat."),
        ],
      },
      {
        kind: "quiz",
        prompt: "What is the risk of changing your play because of a read?",
        choices: [
          right("If the read is wrong, or they adjust, you can do worse than the baseline would have.", "You've left a safe default for a guess. That is why adjustments should follow evidence and start small."),
          wrong("There is no risk; reads are always right.", "Reads are guesses from limited information, and players change."),
          wrong("You will always lose chips.", "Good adjustments win more than the baseline; the risk is in a wrong or stale read."),
        ],
      },
    ],
  },
];
