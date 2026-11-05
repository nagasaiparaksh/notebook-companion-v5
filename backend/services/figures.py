"""Hand-drawn labelled-diagram library (400x400 viewBox). Each figure = illustration + parts with anchor points that lie ON the part.
Used instantly and offline for common subjects; anything else is drawn by the model (see routes/visuals.py)."""
import re

def _v(d, w, fill, dark):  # a tube-like vessel: dark outline stroke under a lighter stroke
    return f'<path d="{d}" fill="none" stroke="{dark}" stroke-width="{w + 6}"/><path d="{d}" fill="none" stroke="{fill}" stroke-width="{w}"/>'
def _b(d, fill, dark, w=4): return f'<path d="{d}" fill="{fill}" stroke="{dark}" stroke-width="{w}"/>'

_BD, _BM, _BL = "#2F4F8F", "#6F8FCF", "#9DB9EE"   # deoxygenated (blue)
_RD, _RM, _RL = "#8E2A27", "#D9534F", "#F29C97"   # oxygenated (red)
HEART = (
 '<g stroke-linejoin="round" stroke-linecap="round">'
 + _v("M137 235 C134 290 136 335 140 396", 24, _BM, _BD)
 + _v("M131 152 C122 105 127 55 135 6", 26, _BM, _BD)
 + _v("M312 160 C338 152 362 146 396 150", 15, _RM, _RD) + _v("M310 178 C336 184 360 194 396 204", 15, _RM, _RD)
 + _b("M252 152 C260 124 302 116 324 140 C338 162 328 192 310 198 C286 188 262 184 248 180 Z", _RL, _RD)
 + _b("M110 214 C102 292 170 352 240 388 C233 322 219 252 215 190 C183 222 142 226 110 214 Z", _BM, _BD)
 + _b("M215 190 C223 262 231 332 240 388 C312 348 344 256 316 196 C293 172 246 172 215 190 Z", _RM, _RD)
 + '<path d="M222 205 C250 218 286 218 313 203" fill="none" stroke="#F4C678" stroke-width="4"/><path d="M238 222 C247 272 254 322 258 356" fill="none" stroke="#F4C678" stroke-width="4"/>'
 + _b("M99 162 C86 202 106 248 152 255 C187 240 198 190 183 148 C166 120 111 126 99 162 Z", _BL, _BD)
 + _v("M232 190 C213 112 232 54 282 60 C322 66 332 100 328 144", 34, _RM, _RD)
 + _v("M192 200 C176 152 200 114 246 106 C280 100 312 104 352 92", 26, _BM, _BD)
 + '</g>')
HEART_PARTS = [
 ("Superior vena cava", "Brings oxygen-poor blood from the head and arms", 130, 60),
 ("Right atrium", "Receives oxygen-poor blood from the body", 140, 200),
 ("Right ventricle", "Pumps blood to the lungs", 160, 300),
 ("Inferior vena cava", "Brings oxygen-poor blood from the lower body", 139, 355),
 ("Aorta", "Carries oxygen-rich blood to the body", 284, 60),
 ("Pulmonary artery", "Carries blood from the heart to the lungs", 300, 100),
 ("Pulmonary veins", "Bring oxygen-rich blood back from the lungs", 372, 150),
 ("Left atrium", "Receives oxygen-rich blood from the lungs", 292, 160),
 ("Left ventricle", "Strongest chamber; pumps blood to the body", 278, 285),
 ("Apex", "Pointed tip of the heart", 240, 380),
]

CELL = (
 '<g stroke-linejoin="round" stroke-linecap="round">'
 + _b("M58 200 C46 100 150 38 240 48 C342 58 374 150 352 250 C336 342 252 372 160 362 C80 352 68 290 58 200 Z", "#FFEAE0", "#D98B6F", 6)
 + '<g fill="none" stroke="#B89AD8" stroke-width="5"><path d="M150 140 C128 165 128 215 150 245"/><path d="M138 128 C110 160 110 225 138 258"/><path d="M126 118 C92 155 92 232 126 270"/></g>'
 + '<circle cx="200" cy="190" r="62" fill="#D4C5F4" stroke="#7B61D9" stroke-width="5"/>'
 + '<circle cx="214" cy="178" r="22" fill="#7B61D9"/>'
 + '<g transform="translate(296 112) rotate(-28)"><ellipse rx="42" ry="22" fill="#F8B49C" stroke="#D9534F" stroke-width="4"/><path d="M-28 0 L-20 -12 L-12 10 L-4 -12 L4 10 L12 -12 L20 8 L28 0" fill="none" stroke="#D9534F" stroke-width="3"/></g>'
 + '<g transform="translate(118 300) rotate(24)"><ellipse rx="40" ry="21" fill="#F8B49C" stroke="#D9534F" stroke-width="4"/><path d="M-26 0 L-18 -11 L-10 9 L-2 -11 L6 9 L14 -11 L22 0" fill="none" stroke="#D9534F" stroke-width="3"/></g>'
 + '<g fill="none" stroke="#E0A92E" stroke-width="9"><path d="M252 262 Q290 244 330 262"/><path d="M256 280 Q292 262 326 280"/><path d="M260 298 Q292 280 322 298"/><path d="M266 316 Q294 300 318 316"/></g>'
 + '<circle cx="132" cy="92" r="17" fill="#A5E0B0" stroke="#2E9E6B" stroke-width="4"/><circle cx="326" cy="196" r="15" fill="#D6EAFF" stroke="#5B8FD6" stroke-width="4"/>'
 + '<g stroke="#5A4A3A" stroke-width="3" fill="#F4E3A8"><rect x="188" y="300" width="34" height="13" rx="6"/><rect x="214" y="306" width="13" height="34" rx="6"/></g>'
 + '<g fill="#3B3B3B"><circle cx="158" cy="226" r="4"/><circle cx="104" cy="196" r="4"/><circle cx="108" cy="228" r="4"/><circle cx="172" cy="118" r="4"/><circle cx="232" cy="106" r="4"/><circle cx="262" cy="150" r="4"/><circle cx="96" cy="166" r="4"/><circle cx="214" cy="270" r="4"/><circle cx="300" cy="320" r="4"/><circle cx="250" cy="352" r="4"/><circle cx="180" cy="338" r="4"/></g>'
 + '</g>')
CELL_PARTS = [
 ("Cell membrane", "Thin boundary that controls what enters and leaves", 352, 236),
 ("Nucleus", "Holds the DNA and directs the cell", 160, 200),
 ("Nucleolus", "Makes ribosome parts", 214, 178),
 ("Rough ER", "Folds and transports proteins", 108, 178),
 ("Ribosomes", "Build proteins", 232, 106),
 ("Lysosome", "Digests waste and worn-out parts", 132, 92),
 ("Mitochondrion", "Releases energy for the cell", 304, 108),
 ("Vacuole", "Stores water and nutrients", 326, 196),
 ("Golgi apparatus", "Packages and ships proteins", 292, 278),
 ("Centrioles", "Help the cell divide", 205, 306),
 ("Cytoplasm", "Jelly-like fluid that fills the cell", 270, 232),
]

_G, _GD = "#7BC47F", "#2B2B2B"
FLOWER = (
 '<g stroke-linejoin="round" stroke-linecap="round" stroke="#2B2B2B" stroke-width="3">'
 + '<path d="M200 40 C150 70 150 150 200 215 C250 150 250 70 200 40 Z" fill="#FBB8D0"/>'
 + '<path d="M186 268 C120 262 52 210 46 128 C44 82 100 72 128 110 C156 148 186 206 192 262 Z" fill="#F7A1C0"/>'
 + '<path d="M214 268 C280 262 348 210 354 128 C356 82 300 72 272 110 C244 148 214 206 208 262 Z" fill="#F7A1C0"/>'
 + '<path d="M200 392 L200 300" fill="none" stroke-width="20"/><path d="M200 392 L200 300" fill="none" stroke="#3E8F4F" stroke-width="14"/>'
 + '<path d="M200 362 C150 374 96 358 64 320 C112 308 168 324 200 350 Z" fill="#7BCB87"/><path d="M196 354 C150 346 110 332 80 322" fill="none" stroke-width="2" opacity=".5"/>'
 + '<path d="M184 292 C140 296 100 276 84 244 C124 244 162 262 190 282 Z" fill="#7BC47F"/><path d="M216 292 C260 296 300 276 316 244 C276 244 238 262 210 282 Z" fill="#7BC47F"/>'
 + '<ellipse cx="200" cy="292" rx="30" ry="14" fill="#B5894F"/>'
 + '<path d="M178 266 C148 244 136 200 140 160" fill="none" stroke-width="10"/><path d="M178 266 C148 244 136 200 140 160" fill="none" stroke="#9AD47F" stroke-width="5"/><ellipse cx="140" cy="150" rx="11" ry="20" fill="#F2B63B"/>'
 + '<path d="M222 266 C252 244 264 200 260 160" fill="none" stroke-width="10"/><path d="M222 266 C252 244 264 200 260 160" fill="none" stroke="#9AD47F" stroke-width="5"/><ellipse cx="260" cy="150" rx="11" ry="20" fill="#F2B63B"/>'
 + '<rect x="195" y="130" width="10" height="92" rx="5" fill="#9AD47F"/>'
 + '<ellipse cx="200" cy="248" rx="25" ry="31" fill="#BFE48C"/>'
 + '<circle cx="192" cy="244" r="5" fill="#F4E27A" stroke-width="2"/><circle cx="208" cy="244" r="5" fill="#F4E27A" stroke-width="2"/><circle cx="200" cy="259" r="5" fill="#F4E27A" stroke-width="2"/>'
 + '<ellipse cx="200" cy="124" rx="17" ry="12" fill="#E8A33C"/>'
 + '</g>')
FLOWER_PARTS = [
 ("Petal", "Bright; attracts pollinators", 76, 140),
 ("Anther", "Makes and holds pollen", 140, 150),
 ("Filament", "Stalk that holds up the anther", 146, 220),
 ("Sepal", "Protects the bud", 130, 268),
 ("Leaf", "Makes food by photosynthesis", 120, 335),
 ("Stigma", "Sticky top that catches pollen", 200, 124),
 ("Style", "Tube that leads down to the ovary", 200, 175),
 ("Ovary", "Contains the ovules (future seeds)", 200, 250),
 ("Receptacle", "Base where flower parts attach", 218, 294),
 ("Stem", "Supports the flower and carries water", 200, 345),
]


import math
def _arrow(x, y, deg, color="#2B2B2B", size=11):  # small filled arrow head at (x,y) pointing along deg
    r = math.radians(deg); pts = []
    for dx, dy in ((0, 0), (-size, -size * .55), (-size, size * .55)):
        pts.append(f"{x + dx * math.cos(r) - dy * math.sin(r):.1f},{y + dx * math.sin(r) + dy * math.cos(r):.1f}")
    return f'<polygon points="{" ".join(pts)}" fill="{color}" stroke="none"/>'

# ------------------------------------------------------------------ lungs
_LD = "#B24A64"
LUNGS = (
 '<g stroke-linejoin="round" stroke-linecap="round">'
 + _b("M40 372 C90 336 310 336 360 372 L360 394 L40 394 Z", "#E3A58A", "#9A5B43")
 + _b("M184 122 C122 104 60 168 58 270 C56 332 88 354 140 348 C176 344 190 322 190 290 Z", "#F7B7C2", _LD)
 + _b("M216 122 C272 106 336 166 340 262 C344 326 312 350 266 345 C238 342 222 322 224 292 C226 262 246 246 238 220 C230 196 220 172 216 122 Z", "#F7B7C2", _LD)
 + _v("M200 18 L200 150", 24, "#BBD7F2", "#4A7CAF")
 + ''.join(f'<path d="M190 {y} L210 {y}" stroke="#4A7CAF" stroke-width="2.5"/>' for y in range(34, 146, 14))
 + _v("M200 146 C192 166 172 176 150 198", 16, "#BBD7F2", "#4A7CAF") + _v("M200 146 C208 166 228 176 250 198", 16, "#BBD7F2", "#4A7CAF")
 + '<g fill="none" stroke="#C9738C" stroke-width="4"><path d="M150 198 C130 216 110 232 100 262"/><path d="M150 198 C152 232 146 262 140 300"/><path d="M128 222 C112 224 96 222 84 214"/><path d="M122 246 C108 252 94 252 82 248"/>'
 + '<path d="M250 198 C268 216 288 232 300 262"/><path d="M250 198 C250 232 256 262 262 300"/><path d="M272 222 C288 224 304 222 316 214"/></g>'
 + ''.join(f'<circle cx="{x}" cy="{y}" r="9" fill="#F58DA1" stroke="{_LD}" stroke-width="2.5"/>' for x, y in ((100, 300), (118, 292), (84, 292), (104, 318), (124, 312), (90, 332), (112, 332)))
 + '</g>')
LUNGS_PARTS = [
 ("Trachea", "Windpipe that carries air to the lungs", 200, 80),
 ("Bronchi", "Two tubes that branch into each lung", 230, 172),
 ("Right lung", "Larger lung with three lobes", 100, 150),
 ("Left lung", "Smaller, makes room for the heart", 300, 190),
 ("Bronchioles", "Tiny branching air tubes", 121, 224),
 ("Alveoli", "Air sacs where oxygen enters the blood", 104, 306),
 ("Diaphragm", "Muscle that pulls air in when it contracts", 200, 372),
]

# ------------------------------------------------------------------ eye
EYE = (
 '<g stroke-linejoin="round" stroke-linecap="round">'
 + _v("M338 232 C360 246 378 256 396 262", 22, "#F2D58A", "#8C6D17")
 + '<path d="M148 123 A120 120 0 1 1 148 277 Z" fill="#F7F3EA" stroke="none"/>'
 + '<path d="M148 123 A120 120 0 1 1 148 277" fill="none" stroke="#2B2B2B" stroke-width="4"/>'
 + '<path d="M155 140 A104 104 0 1 1 155 260 Z" fill="#E4F3E2" stroke="#8BB88A" stroke-width="2"/>'
 + '<g fill="none" stroke="#B9D9B5" stroke-width="2"><path d="M220 160 C240 170 250 190 235 210"/><path d="M260 230 C280 220 300 235 295 255"/><path d="M250 150 C270 140 290 150 300 170"/></g>'
 + '<path d="M294 106 A108 108 0 0 1 294 294" fill="none" stroke="#E58A6B" stroke-width="9"/><circle cx="347" cy="200" r="5" fill="#F4D03F" stroke="#8C6D17" stroke-width="1.5"/>'
 + _b("M150 138 C92 160 92 240 150 262 Z", "#E1F0FB", "none", 0)
 + '<ellipse cx="182" cy="200" rx="20" ry="42" fill="#FFF1B0" stroke="#B8960F" stroke-width="3.5"/>'
 + _b("M172 150 m-14 0 a14 18 0 1 0 28 0 a14 18 0 1 0 -28 0 Z".replace("M172 150", "M172 146"), "#D9A06B", "#7A4E26", 3) + _b("M172 254 m-14 0 a14 18 0 1 0 28 0 a14 18 0 1 0 -28 0 Z".replace("M172 254", "M172 254"), "#D9A06B", "#7A4E26", 3)
 + '<path d="M170 160 L180 164 M170 242 L180 238" stroke="#7A4E26" stroke-width="2"/>'
 + _b("M148 130 C158 134 166 150 164 180 L150 182 C146 166 146 148 148 130 Z", "#5E9BD6", "#2B4A78", 3) + _b("M148 270 C158 266 166 250 164 220 L150 218 C146 234 146 252 148 270 Z", "#5E9BD6", "#2B4A78", 3)
 + '<path d="M148 123 C70 150 70 250 148 277 L150 262 C92 240 92 160 150 138 Z" fill="#CDE6F7" fill-opacity=".85" stroke="#4A7CAF" stroke-width="3.5"/>'
 + '</g>')
EYE_PARTS = [
 ("Cornea", "Clear front window that bends light", 84, 200),
 ("Aqueous humor", "Watery fluid that feeds the front of the eye", 122, 200),
 ("Iris", "Coloured muscle that sets the pupil size", 156, 160),
 ("Pupil", "Opening that lets light in", 156, 200),
 ("Lens", "Focuses light onto the retina", 182, 200),
 ("Ciliary body", "Muscle that changes the lens shape", 178, 138),
 ("Vitreous humor", "Clear jelly that fills the eyeball", 258, 180),
 ("Retina", "Light-sensing layer at the back", 334, 146),
 ("Sclera", "Tough white outer wall", 240, 88),
 ("Optic nerve", "Sends signals to the brain", 382, 255),
]

# ------------------------------------------------------------------ neuron
_NP = "#8F6BD6"
NEURON = (
 '<g stroke-linejoin="round" stroke-linecap="round" fill="none">'
 + f'<g stroke="{_NP}" stroke-width="7"><path d="M70 185 C50 170 35 150 25 120"/><path d="M60 215 C40 235 30 260 22 290"/><path d="M85 160 C85 130 90 100 100 70"/></g>'
 + f'<g stroke="{_NP}" stroke-width="4"><path d="M45 160 C30 160 18 168 12 180"/><path d="M35 140 C22 136 14 128 10 116"/><path d="M40 245 C26 245 16 240 10 230"/><path d="M92 120 C80 112 68 110 58 112"/><path d="M96 92 C108 86 120 86 130 90"/><path d="M32 270 C22 272 14 278 10 290"/></g>'
 + '<path d="M150 200 L330 200" stroke="#2B2B2B" stroke-width="13"/><path d="M150 200 L330 200" stroke="#E7C9B8" stroke-width="8"/>'
 + _b("M128 176 L160 193 L160 207 L128 224 Z", "#C9B6F2", _NP, 3)
 + '<ellipse cx="95" cy="200" rx="44" ry="42" fill="#C9B6F2" stroke="#6B4FC2" stroke-width="4"/>'
 + '<circle cx="95" cy="200" r="17" fill="#8E75E0" stroke="#4B34A3" stroke-width="3"/><circle cx="100" cy="196" r="6" fill="#4B34A3" stroke="none"/>'
 + ''.join(f'<rect x="{x}" y="181" width="38" height="38" rx="16" fill="#F6D77A" stroke="#8C6D17" stroke-width="3.5"/>' for x in (164, 212, 260))
 + ''.join(f'<path d="M{x} 195 L{x + 30} 195 M{x} 205 L{x + 30} 205" stroke="#C9A22E" stroke-width="2"/>' for x in (169, 217, 265))
 + '<g stroke="#2B2B2B" stroke-width="12"><path d="M326 200 C346 200 352 170 372 160"/><path d="M326 200 L368 200"/><path d="M326 200 C346 200 352 230 372 240"/></g>'
 + '<g stroke="#E7C9B8" stroke-width="7"><path d="M326 200 C346 200 352 170 372 160"/><path d="M326 200 L368 200"/><path d="M326 200 C346 200 352 230 372 240"/></g>'
 + ''.join(f'<circle cx="{x}" cy="{y}" r="12" fill="#F2A7B7" stroke="#B24A64" stroke-width="3.5"/>' for x, y in ((378, 156), (380, 200), (378, 244)))
 + '</g>')
NEURON_PARTS = [
 ("Dendrites", "Branches that receive signals", 44, 158),
 ("Cell body", "Contains the nucleus; keeps the cell alive", 118, 226),
 ("Nucleus", "Holds the cell's DNA", 90, 196),
 ("Axon hillock", "Where the signal starts", 143, 200),
 ("Myelin sheath", "Fatty cover that speeds up signals", 231, 190),
 ("Node of Ranvier", "Gap where the signal jumps along", 207, 200),
 ("Axon", "Long fibre that carries the signal", 315, 200),
 ("Axon terminals", "Pass the signal to the next cell", 380, 200),
]

# ------------------------------------------------------------------ water cycle
WATER = (
 '<g stroke-linejoin="round" stroke-linecap="round">'
 + '<rect x="0" y="0" width="400" height="400" rx="14" fill="#E6F4FF" stroke="none"/>'
 + '<g stroke="#F4B400" stroke-width="5"><path d="M60 20 L60 8 M60 100 L60 112 M10 60 L22 60 M98 60 L110 60 M24 24 L32 32 M96 96 L88 88 M96 24 L88 32 M24 96 L32 88"/></g><circle cx="60" cy="60" r="27" fill="#FFD84D" stroke="#C99700" stroke-width="3.5"/>'
 + _b("M200 400 L200 312 C232 300 252 262 284 214 L318 152 L340 186 C360 230 380 280 400 300 L400 400 Z", "#9CCB7B", "#4F7F3A")
 + _b("M304 178 L318 152 L332 176 L322 172 L314 180 Z", "#FFFFFF", "#9AA7B5", 2.5)
 + _b("M200 366 L400 366 L400 400 L200 400 Z", "#B08968", "#7A5A3E", 3) + _b("M206 382 C260 376 330 388 400 380 L400 400 L206 400 Z", "#5FA3DC", "#2F6FAA", 3)
 + _b("M0 300 Q30 290 60 300 T120 300 T180 300 L206 306 L206 400 L0 400 Z", "#6FB1E8", "#2F6FAA")
 + '<g fill="none" stroke="#FFFFFF" stroke-width="3" opacity=".8"><path d="M14 330 q12 -8 24 0 t24 0"/><path d="M100 350 q12 -8 24 0 t24 0"/><path d="M40 372 q12 -8 24 0 t24 0"/></g>'
 + '<path d="M300 200 C285 240 270 270 250 300 C235 312 215 312 200 306" fill="none" stroke="#2F6FAA" stroke-width="12"/><path d="M300 200 C285 240 270 270 250 300 C235 312 215 312 200 306" fill="none" stroke="#6FB1E8" stroke-width="7"/>'
 + '<rect x="221" y="284" width="9" height="26" fill="#7A5A3E" stroke="#4A3524" stroke-width="2.5"/><circle cx="226" cy="268" r="21" fill="#3E8F4F" stroke="#2B5E36" stroke-width="3"/>'
 + '<path d="M242 252 C250 236 236 226 244 206" fill="none" stroke="#2F9E8F" stroke-width="4" stroke-dasharray="3 6"/>' + _arrow(244, 204, -75, "#2F9E8F", 10)
 + '<path d="M90 286 C78 254 104 236 92 204 C84 180 100 170 94 146" fill="none" stroke="#E07A5F" stroke-width="5" stroke-dasharray="2 7"/>' + _arrow(94, 142, -80, "#E07A5F", 12)
 + '<path d="M146 286 C134 254 160 236 148 204 C140 180 156 170 150 150" fill="none" stroke="#E07A5F" stroke-width="5" stroke-dasharray="2 7"/>' + _arrow(150, 146, -80, "#E07A5F", 12)
 + '<g fill="#FFFFFF" stroke="#8AA0B8" stroke-width="3"><circle cx="196" cy="84" r="24"/><circle cx="228" cy="66" r="30"/><circle cx="264" cy="82" r="26"/><rect x="196" y="82" width="68" height="28" rx="4" stroke="none"/></g><path d="M174 108 L286 108" stroke="#8AA0B8" stroke-width="3"/>'
 + '<rect x="190" y="84" width="84" height="24" fill="#FFFFFF" stroke="none"/>'
 + '<g stroke="#2F6FAA" stroke-width="4"><path d="M206 118 L198 148"/><path d="M232 120 L224 152"/><path d="M258 118 L250 148"/><path d="M219 134 L212 160"/><path d="M245 136 L238 162"/></g>'
 + '<path d="M334 318 L334 360" stroke="#2F6FAA" stroke-width="5" stroke-dasharray="2 7"/>' + _arrow(334, 362, 90, "#2F6FAA", 11)
 + '</g>')
WATER_PARTS = [
 ("Sun", "Heat energy that drives the cycle", 60, 60),
 ("Evaporation", "Water turns to vapour and rises", 94, 205),
 ("Condensation", "Vapour cools into clouds", 230, 76),
 ("Precipitation", "Rain, snow or hail falls", 236, 140),
 ("Transpiration", "Plants release water vapour", 226, 266),
 ("Runoff", "Water flows downhill to rivers and seas", 277, 254),
 ("Infiltration", "Water soaks into the ground", 334, 340),
 ("Groundwater", "Water stored underground", 300, 390),
 ("Collection", "Oceans and lakes store water", 90, 345),
]

# ------------------------------------------------------------------ electric circuit
_W = "#2B2B2B"; _CU = "#E08A3C"
CIRCUIT = (
 '<g stroke-linejoin="round" stroke-linecap="round">'
 + _v("M60 160 L60 90 L130 90", 7, _CU, _W) + _v("M200 90 L340 90 L340 168", 7, _CU, _W) + _v("M340 250 L340 310 L270 310", 7, _CU, _W) + _v("M170 310 L60 310 L60 250", 7, _CU, _W)
 + _b("M44 164 h32 a6 6 0 0 1 6 6 v76 a6 6 0 0 1 -6 6 h-32 a6 6 0 0 1 -6 -6 v-76 a6 6 0 0 1 6 -6 Z", "#F2B63B", "#8C6D17")
 + '<rect x="44" y="164" width="32" height="26" fill="#2B2B2B" stroke="none"/><rect x="50" y="154" width="20" height="12" rx="3" fill="#C9C9C9" stroke="#555" stroke-width="3"/>'
 + '<path d="M52 177 h16 M60 169 v16" stroke="#fff" stroke-width="3.5"/><path d="M52 236 h16" stroke="#2B2B2B" stroke-width="3.5"/>'
 + '<rect x="110" y="96" width="110" height="12" rx="4" fill="#9AA3AD" stroke="#4A525B" stroke-width="3"/>'
 + '<circle cx="130" cy="90" r="8" fill="#C9C9C9" stroke="#4A525B" stroke-width="3"/><circle cx="200" cy="90" r="8" fill="#C9C9C9" stroke="#4A525B" stroke-width="3"/>'
 + '<path d="M130 90 L186 52" stroke="#2B2B2B" stroke-width="9"/><path d="M130 90 L186 52" stroke="#D9534F" stroke-width="5"/>'
 + _arrow(270, 90, 0, "#D9534F", 14)
 + '<circle cx="340" cy="206" r="40" fill="#FFF3A3" fill-opacity=".85" stroke="#8C6D17" stroke-width="4"/><path d="M322 242 C318 222 332 220 336 206 C340 192 354 194 358 170" fill="none" stroke="#D9534F" stroke-width="3.5"/>'
 + '<path d="M320 238 L326 214 M360 238 L354 214" stroke="#8C6D17" stroke-width="2.5"/><path d="M324 236 C326 224 332 218 340 214 C348 218 354 224 356 236" fill="none" stroke="#D9534F" stroke-width="4"/>'
 + '<rect x="322" y="244" width="36" height="12" rx="3" fill="#B8B8B8" stroke="#4A525B" stroke-width="3"/><rect x="326" y="256" width="28" height="10" rx="3" fill="#8D8D8D" stroke="#4A525B" stroke-width="3"/>'
 + '<rect x="170" y="294" width="100" height="32" rx="8" fill="#E8CFA0" stroke="#7A5A3E" stroke-width="3.5"/><rect x="190" y="294" width="10" height="32" fill="#D9534F" stroke="none"/><rect x="212" y="294" width="10" height="32" fill="#7B61D9" stroke="none"/><rect x="234" y="294" width="10" height="32" fill="#E8590C" stroke="none"/>'
 + '</g>')
CIRCUIT_PARTS = [
 ("Positive terminal", "Where current leaves the battery", 60, 160),
 ("Battery", "Pushes the current around the circuit", 60, 214),
 ("Switch", "Opens or closes the circuit", 160, 72),
 ("Wire", "Copper path that carries the current", 60, 120),
 ("Current direction", "Conventional flow: + to −", 268, 90),
 ("Bulb", "Lights up when current flows", 350, 190),
 ("Resistor", "Limits the current", 220, 310),
]

_GLOBAL_SKIP = r"\b(lstm|gru|rnn|cnn|transformers?|neural\s+network|memory\s+cell)\b"
FIGURES = [
 {"id": "heart", "title": "The human heart", "match": r"\bheart\b|cardiac|cardiovascular", "drawing": HEART, "parts": HEART_PARTS},
 {"id": "lungs", "title": "The human lungs", "match": r"\blungs?\b|respiratory\s+system|\btrachea\b", "exclude": r"cancer|disease", "drawing": LUNGS, "parts": LUNGS_PARTS},
 {"id": "eye", "title": "Structure of the human eye", "match": r"\beyes?(ball)?\b", "drawing": EYE, "parts": EYE_PARTS},
 {"id": "neuron", "title": "A neuron (nerve cell)", "match": r"\bneurons?\b|\bnerve\s+cells?\b", "drawing": NEURON, "parts": NEURON_PARTS},
 {"id": "water-cycle", "title": "The water cycle", "match": r"water\s+cycle|hydrologic(al)?\s+cycle|rain\s+cycle", "drawing": WATER, "parts": WATER_PARTS},
 {"id": "circuit", "title": "A simple electric circuit", "match": r"(simple\s+|basic\s+|electric(al)?\s+)?circuit\b|\bbattery\b.*\bbulb\b", "exclude": r"\b(integrated|logic|printed|digital|short)\b", "drawing": CIRCUIT, "parts": CIRCUIT_PARTS},
 {"id": "animal-cell", "title": "Animal cell", "match": r"\b(animal|eukaryotic|human)?\s*cell\b(?!\s*(state|gate))", "exclude": r"plant|bacteri|prokaryot|stem|blood|nerve|cancer|sperm|egg|red|white|fat|muscle|root|battery|solar|fuel|prison|spread\s?sheet|memory|neural|nerve", "drawing": CELL, "parts": CELL_PARTS},
 {"id": "flower", "title": "Parts of a flower", "match": r"\bflower(s|ing)?\b|\bblossom\b", "drawing": FLOWER, "parts": FLOWER_PARTS},
]
def find(subject):
    s = (subject or "").lower().strip()
    if not s or len(s) > 60 or re.search(_GLOBAL_SKIP, s): return None
    for f in FIGURES:
        if re.search(f["match"], s) and not (f.get("exclude") and re.search(f["exclude"], s)): return f
    return None
def as_dict(f): return {"id": f["id"], "title": f["title"], "drawing": f["drawing"], "source": "library",
                        "parts": [{"label": a, "detail": b, "x": x, "y": y} for a, b, x, y in f["parts"]]}
