/**
 * Campaign categories — what widens AI Ad Studio from "product on a podium"
 * into a system that shoots luxury fashion, cosmetics, jewellery, perfume,
 * watches, automotive, hotels, restaurants, e-commerce, lifestyle and virtual
 * brand ambassadors.
 *
 * The reason this is a separate axis and not just more scenes: the existing
 * scenes all assume ONE grammar — an object standing on a surface. That grammar
 * is wrong for half the market. A car is photographed in an environment, a hotel
 * or restaurant IS the environment and has no product object at all, and fashion
 * and ambassador work is built around a person. Each category therefore carries
 * its own shot grammar and its own scene vocabulary.
 *
 * `subject` describes what the customer types in. `lead` is the opening of the
 * prompt, which must come first — measured behaviour: framing described after a
 * long subject description is ignored.
 */

export type CategoryId =
  | 'product' | 'cosmetics' | 'jewellery' | 'watches' | 'perfume'
  | 'fashion' | 'automotive' | 'hospitality' | 'dining' | 'lifestyle' | 'ambassador'

export interface CategoryScene {
  id: string
  name: string
  blurb: string
  scene: string
  /** How far a render may travel from the customer's photo (0-1). */
  strength: number
}

export interface Category {
  id: CategoryId
  name: string
  blurb: string
  /** What the customer is asked to describe. */
  subjectLabel: string
  subjectPlaceholder: string
  /** Opening of the prompt — the shot grammar. MUST lead. */
  lead: string
  /** True when the frame is built around a person, not an object. */
  personLed: boolean
  /** Craft language for this category's medium. */
  craft: string
  scenes: CategoryScene[]
}

/** Shared craft vocabularies, so a change to "how a still life is shot" lands everywhere. */
const CRAFT_STILL =
  'shot on a full-frame camera with an 85mm lens, shallow depth of field, true-to-life colour, '
  + 'crisp product edges, natural material texture, commercial advertising photography, high detail'
const CRAFT_WIDE =
  'shot on a full-frame camera with a 35mm lens, deep focus, balanced natural colour, '
  + 'architectural precision, commercial campaign photography, high detail'
const CRAFT_PERSON =
  'natural asymmetric catchlights in the eyes, clear even complexion with fine natural skin texture, '
  + 'shot on a full-frame camera with an 85mm lens at f/2.0, photorealistic, tack sharp eyes, high dynamic range'
const CRAFT_MACRO =
  'shot with a 100mm macro lens, focus stacked for edge-to-edge sharpness, controlled specular highlights, '
  + 'true metal and gemstone reflections, luxury catalogue photography'

/** Removes the usual generative tells; applied on providers that accept a negative prompt. */
export const CATEGORY_NEGATIVE =
  'text, watermark, logo overlay, caption, extra objects, duplicated subject, distorted proportions, '
  + 'plastic-looking surface, oversaturated, blurry subject, cluttered composition, deformed hands, '
  + 'bad anatomy, cgi, 3d render'

export const CATEGORIES: Category[] = [
  {
    id: 'product',
    name: 'E-commerce product',
    blurb: 'Clean, consistent shots that convert on a product page.',
    subjectLabel: 'Your product',
    subjectPlaceholder: 'matte black water bottle with a bamboo lid',
    lead: 'professional advertising photograph of',
    personLed: false,
    craft: CRAFT_STILL,
    scenes: [
      { id: 'seamless_white', name: 'Seamless White', blurb: 'Marketplace standard — pure white, no distractions.', scene: 'on a seamless pure white background, bright even softbox lighting, soft contact shadow beneath', strength: 0.4 },
      { id: 'pastel_riser',   name: 'Pastel Riser',   blurb: 'Colour block with a geometric riser. Scroll-stopping.', scene: 'on a seamless soft pastel backdrop with a coloured geometric riser, bright even lighting, minimal contemporary styling', strength: 0.5 },
      { id: 'marble_studio',  name: 'Marble Studio',  blurb: 'Polished marble, soft daylight. The premium default.', scene: 'on a polished white marble podium, soft diffused daylight from the left, gentle shadow falloff, warm neutral background', strength: 0.45 },
      { id: 'concrete_hard',  name: 'Concrete & Drama', blurb: 'Raw concrete, hard side light. Modern and expensive.', scene: 'on a raw concrete plinth, dramatic hard side lighting, deep shadows, dark charcoal background, single key light with a soft rim highlight', strength: 0.5 },
    ],
  },
  {
    id: 'cosmetics',
    name: 'Cosmetics & skincare',
    blurb: 'Texture, freshness and glow — the language beauty buyers read.',
    subjectLabel: 'Your product',
    subjectPlaceholder: 'frosted glass serum bottle with a gold dropper',
    lead: 'professional beauty advertising photograph of',
    personLed: false,
    craft: CRAFT_STILL,
    scenes: [
      { id: 'wet_glass',    name: 'Glass & Water',   blurb: 'Droplets and caustics — fresh and hydrating.', scene: 'on a wet glass surface with fine water droplets and light caustics, cool clean lighting, pale blue-grey gradient background', strength: 0.4 },
      { id: 'sunlit_linen', name: 'Sunlit Linen',    blurb: 'Warm window light on linen. Editorial, human.', scene: 'on rumpled natural linen in warm late-afternoon window light, soft window-frame shadows, airy off-white background', strength: 0.45 },
      { id: 'cream_swatch', name: 'Texture Swatch',  blurb: 'The product beside its own texture. Proof of formula.', scene: 'beside a clean swatch of its own cream texture on a stone surface, soft top light, macro detail on the texture, minimal neutral background', strength: 0.4 },
      { id: 'botanical',    name: 'Botanical',       blurb: 'Fresh botanicals — natural and clinical at once.', scene: 'surrounded by fresh botanical leaves and cut ingredients on pale stone, bright natural daylight, clean airy background', strength: 0.45 },
    ],
  },
  {
    id: 'jewellery',
    name: 'Jewellery',
    blurb: 'Macro precision — metal that reads as metal, stones that fire.',
    subjectLabel: 'Your piece',
    subjectPlaceholder: 'white gold ring with a solitaire diamond',
    lead: 'luxury macro product photograph of',
    personLed: false,
    craft: CRAFT_MACRO,
    scenes: [
      { id: 'black_velvet', name: 'Black Velvet',  blurb: 'Deep black, single beam. Classic high jewellery.', scene: 'on black velvet with a single narrow beam of light, rich deep blacks, controlled specular sparkle, subtle golden rim light', strength: 0.35 },
      { id: 'silk_fold',    name: 'Silk Fold',     blurb: 'Draped silk — soft luxury, catalogue-ready.', scene: 'resting in a fold of champagne silk, soft diffused light with a bright reflector, warm neutral background', strength: 0.4 },
      { id: 'stone_slab',   name: 'Stone Slab',    blurb: 'Raw stone against fine metal. Contrast sells.', scene: 'on a raw grey stone slab, crisp directional light, cool colour grade, dark minimal background', strength: 0.4 },
      { id: 'water_ripple', name: 'Water',         blurb: 'Half-submerged — light plays through the stone.', scene: 'partly submerged in still clear water with gentle ripples, bright top light, caustic patterns, pale background', strength: 0.4 },
    ],
  },
  {
    id: 'watches',
    name: 'Watches',
    blurb: 'Dial legibility and metal finish — what collectors actually judge.',
    subjectLabel: 'Your watch',
    subjectPlaceholder: 'stainless steel diver with a blue ceramic bezel',
    lead: 'luxury macro product photograph of',
    personLed: false,
    craft: CRAFT_MACRO,
    scenes: [
      { id: 'dark_metal',  name: 'Dark Metal',   blurb: 'Brushed metal, controlled reflections. Reference shot.', scene: 'on a brushed dark metal surface, controlled strip-light reflections along the case, deep black background, dial fully legible', strength: 0.35 },
      { id: 'leather_desk',name: 'Leather Desk', blurb: 'Leather and warm light — the collector\'s desk.', scene: 'on a tan leather desk pad beside a fountain pen, warm directional lamp light, shallow depth of field, dark wood background', strength: 0.4 },
      { id: 'stone_water', name: 'Stone & Water',blurb: 'Wet stone — proves the sports-watch story.', scene: 'on wet dark stone with scattered water droplets, cool crisp lighting, dramatic contrast, deep blue background', strength: 0.4 },
      { id: 'white_gallery',name:'White Gallery',blurb: 'Museum-clean. Nothing competes with the dial.', scene: 'on a seamless white surface with a soft gradient background, large diffused light, precise controlled highlights', strength: 0.35 },
    ],
  },
  {
    id: 'perfume',
    name: 'Perfume',
    blurb: 'Atmosphere over object — fragrance is sold as a feeling.',
    subjectLabel: 'Your bottle',
    subjectPlaceholder: 'tall amber glass bottle with a brushed gold cap',
    lead: 'luxury fragrance advertising photograph of',
    personLed: false,
    craft: CRAFT_STILL,
    scenes: [
      { id: 'satin_beam',  name: 'Satin & Beam',  blurb: 'Black satin, one beam, smoke. Prestige signature.', scene: 'on black satin fabric with a single narrow beam of light, rich deep blacks, subtle golden rim light, smoke haze in the background', strength: 0.4 },
      { id: 'desert_dune', name: 'Desert Light',  blurb: 'Warm sand and long shadow. Oriental, woody.', scene: 'standing on rippled desert sand at golden hour, long dramatic shadow, warm amber sky gradient', strength: 0.45 },
      { id: 'florals',     name: 'Fresh Florals', blurb: 'Petals and dew — floral and feminine.', scene: 'surrounded by fresh petals and morning dew on pale marble, soft diffused daylight, airy pastel background', strength: 0.45 },
      { id: 'ice_water',   name: 'Ice & Water',   blurb: 'Splash and ice — fresh, aquatic, masculine.', scene: 'with a frozen water splash and clear ice fragments, crisp cool lighting, deep blue gradient background', strength: 0.45 },
    ],
  },
  {
    id: 'fashion',
    name: 'Luxury fashion',
    blurb: 'Garments on a model — the only way apparel truly sells.',
    subjectLabel: 'The look',
    subjectPlaceholder: 'oversized cream wool coat over a black turtleneck',
    lead: 'full-length luxury fashion campaign photograph, full body in frame, of a model wearing',
    personLed: true,
    craft: CRAFT_PERSON,
    scenes: [
      { id: 'brutalist',   name: 'Brutalist',     blurb: 'Concrete architecture — hard, modern, editorial.', scene: 'against raw brutalist concrete architecture, hard directional daylight, strong geometric shadows, muted palette', strength: 0.5 },
      { id: 'studio_grey', name: 'Studio Grey',   blurb: 'Seamless grey. The garment is the whole story.', scene: 'on a seamless mid-grey studio backdrop, large octabox key with soft fill, clean even lighting', strength: 0.45 },
      { id: 'coastal',     name: 'Coastal Wind',  blurb: 'Sea wind and movement — resort and summer.', scene: 'on a windswept coastal cliff at golden hour, fabric moving in the wind, warm backlight, ocean bokeh', strength: 0.5 },
      { id: 'night_street',name: 'Night Street',  blurb: 'Wet asphalt and neon. Streetwear energy.', scene: 'on a wet city street at night with neon reflections, direct flash with ambient neon spill, urban depth', strength: 0.55 },
    ],
  },
  {
    id: 'automotive',
    name: 'Automotive',
    blurb: 'Cars live in environments, never on podiums.',
    subjectLabel: 'The vehicle',
    subjectPlaceholder: 'matte grey electric sports sedan',
    lead: 'wide automotive advertising photograph of',
    personLed: false,
    craft: CRAFT_WIDE,
    scenes: [
      { id: 'coast_road',  name: 'Coast Road',    blurb: 'Cliff road at golden hour. The classic hero shot.', scene: 'on a winding coastal cliff road at golden hour, low sun flare, ocean horizon behind, dynamic three-quarter angle', strength: 0.5 },
      { id: 'salt_flat',   name: 'Salt Flat',     blurb: 'Empty white plain — pure form, no distraction.', scene: 'alone on a vast white salt flat under a dramatic sky, hard midday light, mirrored surface reflection, ultra-wide horizon', strength: 0.5 },
      { id: 'city_night',  name: 'City Night',    blurb: 'Neon underpass — performance and tech.', scene: 'in a neon-lit city underpass at night, wet asphalt reflections, long exposure light trails, cool cinematic grade', strength: 0.55 },
      { id: 'alpine_pass', name: 'Alpine Pass',   blurb: 'Mountain switchbacks — capability and freedom.', scene: 'on an alpine mountain pass with switchbacks behind, crisp clear daylight, snow-capped peaks, deep landscape', strength: 0.5 },
    ],
  },
  {
    id: 'hospitality',
    name: 'Hotels & resorts',
    blurb: 'The space IS the product — interiors, not objects.',
    subjectLabel: 'The space',
    subjectPlaceholder: 'minimalist suite with floor-to-ceiling sea view',
    lead: 'wide architectural hospitality photograph of',
    personLed: false,
    craft: CRAFT_WIDE,
    scenes: [
      { id: 'golden_suite', name: 'Golden Hour Suite', blurb: 'Warm low sun through glass. Aspirational.', scene: 'with late golden-hour sun raking across the room through floor-to-ceiling windows, warm highlights, long soft shadows', strength: 0.45 },
      { id: 'blue_hour',    name: 'Blue Hour',         blurb: 'Dusk with warm interior lights. Signature hotel shot.', scene: 'at blue hour with warm interior lighting glowing against a deep blue dusk sky, balanced exposure inside and out', strength: 0.45 },
      { id: 'poolside',     name: 'Poolside',          blurb: 'Water, loungers, palm shadow. Resort promise.', scene: 'beside an infinity pool with loungers and palm shadows, bright clear daylight, turquoise water, wide open horizon', strength: 0.5 },
      { id: 'spa_calm',     name: 'Spa Calm',          blurb: 'Low warm light, stone and steam. Wellness.', scene: 'in a low-lit stone spa with candles and gentle steam, warm soft light, tranquil muted palette', strength: 0.45 },
    ],
  },
  {
    id: 'dining',
    name: 'Restaurants & food',
    blurb: 'Appetite is lighting — the dish must look edible, not styled to death.',
    subjectLabel: 'The dish or venue',
    subjectPlaceholder: 'hand-rolled pasta with truffle and parmesan',
    lead: 'appetising food advertising photograph of',
    personLed: false,
    craft: CRAFT_STILL,
    scenes: [
      { id: 'dark_rustic',  name: 'Dark & Rustic',  blurb: 'Moody wood and side light. Fine dining.', scene: 'on a dark rustic wooden table with dramatic side window light, deep shadows, rich warm tones, steam rising', strength: 0.45 },
      { id: 'bright_marble',name: 'Bright Marble',  blurb: 'Clean and fresh — brunch and healthy menus.', scene: 'on white marble with bright natural daylight, fresh ingredients scattered around, clean airy composition', strength: 0.45 },
      { id: 'table_scene',  name: 'Full Table',     blurb: 'The whole table — shows the experience, not one plate.', scene: 'as part of a full styled table setting with glassware and linen, warm restaurant ambience, shallow depth of field', strength: 0.5 },
      { id: 'chef_pass',    name: 'Chef\'s Pass',   blurb: 'Kitchen pass under service light. Authenticity.', scene: 'on a stainless steel kitchen pass under focused service lighting, dark background, professional kitchen atmosphere', strength: 0.5 },
    ],
  },
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    blurb: 'Product in a real life — where the customer imagines themselves.',
    subjectLabel: 'Product in use',
    subjectPlaceholder: 'ceramic mug on a morning desk',
    lead: 'natural lifestyle advertising photograph of',
    personLed: false,
    craft: CRAFT_STILL,
    scenes: [
      { id: 'morning_desk', name: 'Morning Desk',  blurb: 'Soft morning light on a working desk.', scene: 'on a wooden desk in soft morning window light with everyday objects around, warm natural palette, lived-in feel', strength: 0.5 },
      { id: 'kitchen_home', name: 'Home Kitchen',  blurb: 'Real kitchen, real daylight. Trustworthy.', scene: 'on a home kitchen counter in bright natural daylight, subtle everyday clutter, warm domestic atmosphere', strength: 0.5 },
      { id: 'outdoor_walk', name: 'Outdoors',      blurb: 'Carried outdoors — active and real.', scene: 'outdoors on a sunlit path with natural greenery bokeh, warm backlight, candid documentary feel', strength: 0.55 },
      { id: 'cafe_table',   name: 'Café Table',    blurb: 'Café ambience — social and aspirational.', scene: 'on a café table with soft window light and blurred interior behind, warm inviting tones', strength: 0.5 },
    ],
  },
  {
    id: 'ambassador',
    name: 'Virtual brand ambassador',
    blurb: 'A consistent synthetic face that presents your product across every post.',
    subjectLabel: 'What they present',
    subjectPlaceholder: 'holding a frosted glass serum bottle',
    lead: 'head and shoulders brand campaign photograph of an original fictional adult model',
    personLed: true,
    craft: CRAFT_PERSON,
    scenes: [
      { id: 'clean_studio', name: 'Clean Studio',  blurb: 'Bright seamless studio — the versatile default.', scene: 'on a clean seamless studio backdrop, bright clamshell beauty lighting with reflector fill, luminous even skin', strength: 0.45 },
      { id: 'red_carpet',   name: 'Red Carpet',    blurb: 'Direct flash, cool grade. High-fashion presence.', scene: 'with direct on-camera flash like a red carpet photograph, crisp specular highlights, cool colour grade, blurred dark event background', strength: 0.45 },
      { id: 'penthouse',    name: 'Penthouse',     blurb: 'Designer interior at golden hour. Aspirational.', scene: 'in a modern penthouse with minimal Scandinavian designer furniture and floor-to-ceiling windows, golden hour light', strength: 0.5 },
      { id: 'daylight_home',name: 'Daylight Home', blurb: 'Soft window light — approachable and honest.', scene: 'in a bright home interior with soft diffused window light, warm natural palette, relaxed everyday setting', strength: 0.5 },
    ],
  },
]

/** Shown with any published render that contains a synthetic person. */
export const AI_DISCLOSURE = 'AI-generated image. Any person shown is not a real individual.'

export function getCategory(id: CategoryId): Category | undefined {
  return CATEGORIES.find((c) => c.id === id)
}

export function getCategoryScene(categoryId: CategoryId, sceneId: string): CategoryScene | undefined {
  return getCategory(categoryId)?.scenes.find((s) => s.id === sceneId)
}
