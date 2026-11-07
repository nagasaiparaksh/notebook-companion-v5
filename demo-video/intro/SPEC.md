# Intro: "Writing → Typing → Touch → Voice"

GOAL:    In 24 s the viewer feels the jump from pen to voice, and arrives curious at the real Notebook Companion screen
         ("what if we could talk to our knowledge?"), which hands straight into the product demo.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps. Prepended to demo_1.3x.mp4.
TIME:    24.6 s x 30 = 738 frames. No voiceover (space left for one): the lower 22% of the frame stays free of action-critical
         detail in shots 1-4 and the question card sits in the upper 60%.

LOOK:    Medium: flat vector cartoon, the product's own ink. Every shape has a 4 px outline in ink #2B2B2B (the app's --ink),
         flat fills + one shade per material (multiply-darker 12%), no gradients except the lamp's light pool.
         Warm study room: wall #EFE2CF, lamp light pool radial #FFF3D6 -> wall at 38% opacity, desk #B9805A top / #9C6544 front,
         chair #39404D. Character: skin #C98B60 (shade #B07548), hair #241812, hoodie #3B5BDB (the app's blue, shade #2F49B0),
         t-shirt collar #FFFFFF, glasses frame ink 4 px. Paper #FFFDF5 with rule lines #CFD8EA 2 px. Accent #FFE45C (the app's
         yellow) only on: the pen's cap, the voice waves' core, the word "TALK", the mic.
         Handwriting: Patrick Hand (the app's face). Typed screen text and the question: Inter 700/900.
         Dark ground (asked for in the brief) #0E1116, waves #FFE45C core with an 18 px blur halo at 35% (the brief's "subtle glow").
         Light: lamp key from upper left; contact shadows ink at 18% under every object on the desk; 5% vignette in the room shots.
OBJECTS: one student (same rig all film: 3/4 view facing right, round glasses, blue hoodie with white drawstrings, short
         black hair with a fringe); a spiral notebook (rings, rule lines, margin line); a pen held in a fist; a laptop
         (bezel, camera dot, keyboard deck with key rows, trackpad); a tablet (rounded 26 px, home bar); a desk lamp; a small
         plant; three books. Each must read without a label.
MOTION:  enter expo.out / power4.out; camera power2.inOut; exits power3.in, 40-50% shorter than entries;
         morphs 0.9 s power3.inOut. Character: head leads, arms follow 3-5 frames later; blinks 4 frames at seeded times;
         mood changes = anticipation (2 frames) -> squash -> new face -> settle (6 frames). Typing hands alternate, never in unison.
SHOTS:
  1  0-150   WRITING. Wide room 0-40, camera pushes 1.0 -> 2.15 onto the notebook (power2.inOut, 40-150). Pen writes 4 lines
             (title + 3 bullets) with the tip on the ink edge. Read: handwritten notes filling. Sound: pen scratch.
  2  150-300 TYPING. The page lifts and rotates up into a laptop screen (0.9 s morph) while the camera eases back to 1.35;
             handwriting blurs out line by line as the same words reappear typed (Inter); keyboard deck slides in under it.
             Hands alternate on keys; the screen fills with 4 more lines + caret. Sound: key ticks.
  3  300-450 TOUCH. Laptop deck folds away, screen shrinks to a tablet (0.9 s). Finger taps (card highlights), swipes
             (cards slide left), scrolls (list moves up). Instant UI response. Sound: taps, swipe.
  4  450-588 VOICE. Tablet set down on a stand; hands withdraw. Student leans in, speaks: 3 wave arcs travel mouth -> tablet
             (0.6 s each, 0.25 s apart); tablet shows a live waveform then an answer card. Face: curious -> surprised (brows up,
             eyes wide, O mouth) -> excited smile. Sound: soft voice whoosh.
  5  588-600 FREEZE: the frame holds dead still for 12 frames.
  6  600-700 QUESTION. Ground floods to #0E1116 in 0.4 s while the tablet's waveform carries across and stretches into a full-width
             sound wave at y=760. "WHAT IF WE COULD / TALK TO OUR KNOWLEDGE?" Inter 900, 112 px, -2% tracking, per-word blur-in
             (8 px -> 0, 0.15 s, 0.09 s apart), "TALK" in #FFE45C. Holds dead still until 702.
  7  700-738 BRIDGE. The wave collapses into a 104 px yellow disc at the app's mic position (960, 948) and the real app
             screenshot opens around it (iris from the mic, 0.5 s power3.inOut). Ends on the real screen.
BANNED:  a dark void anywhere except shot 6-7 (asked for); purple gradients, glass cards, lens flares, particles; everything
         centred (room shots are 3/4, character left third); fade-and-slide-up entries; titles that drift after landing;
         a childish look (no bouncing eyes, no rubber limbs, no sparkles); text other than the question and on-screen UI text.
QA:      f20 wide room reads (student, desk, lamp, notebook); f120 pen tip on the ink edge, 3 lines written;
         f210 laptop with typed text, both hands on keys; f380 tablet with finger mid-swipe; f520 wave arcs between mouth and
         tablet, surprised face; f600 still; f690 question fully on, TALK yellow; f737 real app screen, mic at (960, 948).
