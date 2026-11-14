---
name: render-to-film
description: How the owner's own app, Render to Film, writes prompts that turn an architectural render into a photoreal still and into a calm clip. Advice for the Artist and the Art director. Read before writing any still's or clip's prompt.
---

# Render to Film: the recipes

Render to Film is the owner's own app. It takes a computer-made render of a building and re-shoots it as a real photograph, then animates the photograph. Everything below is what its prompts have learned over many tries. Take it as advice: the ideas, the order and the words that worked. Do not copy a paragraph whole; write for the picture in front of you.

This playbook is about words only. You never use the app. You make pictures and clips through the generation door, inside the batch the owner approved, and `IN-THIS-ENGINE.md` beside this file says how that works here.

## The one idea under all of it

The render is the complete truth about the place. The model's job is to make that exact place look real, never to improve it. Every recipe below protects this. Four habits follow.

1. Say what stays before you say what changes. The first sentence of a good prompt names the thing to keep: the camera position, the framing, the architecture, the layout.
2. Name the things that must not move or appear: walls, sculptures, trees, lamps, pools, kerbs, planting, paving lines, the sky. Say they stay "in the same number, shape, position and material".
3. Describe what you want, in plain flowing sentences, and keep the list of things to avoid short and at the very end. Models obey a positive picture better than a list of bans.
4. Put the most important sentences first. When a prompt is too long for the model, the end is what gets cut, so the end should hold what can be spared.

## A still's prompt, in the order that works

Write one paragraph of sentences in this order.

1. **What it is.** "Re-photograph the scene in the reference image as a real, photorealistic film still, keeping the exact same composition, camera position, framing, architecture, objects and layout." If the camera is to move a little, say so here instead, and say it is a different camera position of the same scene.
2. **What must not change.** A fidelity sentence: every wall, sculpture, tree, lamp, pool, kerb, plant, paving line and the sky stay exactly as designed, in the same number, shape, position and material, with nothing added, removed, moved or redesigned. Add that anything a new viewpoint brings into frame is a direct continuation of what is already visible: the same paving pattern, the same planting, the same stone, the same sky.
3. **Make the surfaces real.** Turn every computer-made surface into its real material: stone with true texture, weathering and moisture; water with real transparency, flow and reflections; plants and trees with natural leaf variation and depth; metal with true patina.
4. **The light.** One sentence naming the light (the looks list below). If the render's own light is to stay, say "keep" and describe it as it is: the same time of day, sun direction and height, shadow direction, length and softness, sky and weather, exposure and colour balance. Only the surfaces become real; nothing is relit or regraded.
5. **The camera.** "Shoot it like a high-end cinema camera with an anamorphic lens: natural depth of field, subtle lens falloff and vignetting, fine organic film grain, true dynamic range." When the render's own colours are to stay, add that the render's own colours and tones are kept rather than a grade added. Otherwise add rich shadows, controlled highlights and a refined cinematic grade.
6. **A grade, only if the task asks for one.** One sentence, from the grade words below, ending: the grade changes colour and tone only, never the light direction, the architecture, the materials or what is in the frame.
7. **The owner's own direction.** Put it near the end and begin it "Also:". Of everything in the prompt, this is the part you never shorten.
8. **The closing line.** "The result is a single, ultra-realistic, award-winning cinematography frame."

### The switch that matters most: only what is in the image

The app has a switch, on by default, called "Only what's in the image". When it is on, a strict sentence is added: nothing appears that is not already visible in the reference. No new objects, buildings, furniture, plants, vehicles, animals, signs, text, sky features or light sources, and nothing is removed. If the frame is wider or the camera moves, keep the new framing close enough that it shows only what the reference already holds, continuing its edges and never inventing space beyond them. And the owner's extra direction is introduced as "Also, using only what is already in the image". In this engine, assume this switch is on for every still and every clip.

### A different frame shape

When the output is a different shape from the render, add one sentence: compose the photograph in that shape around the same subject and viewpoint. Where the new frame reaches past the render's edges, only continue what is already there at the edges (paving, wall, water, planting, sky) and add no new buildings or features. Where it shows less, crop in. Never squeeze, stretch or distort anything to fit.

### A marked area

When only one area of a picture is to change, say it first: edit only that area, keep everything outside it exactly as it is, with the same composition, camera, framing, light, colour and grade, and make the changed area blend into the untouched picture in perspective, scale, light direction, colour, sharpness and grain. Do not relight or regrade anything outside it. A marked edit never moves the camera and never takes a lighting reference.

### A lighting reference

When a second picture is there only to give its light, say so: it is a lighting reference only. Take nothing from it but its light: time of day, the sun's direction and height, shadow direction, length and softness, sky and weather, haze, the colour and temperature of the light, contrast, exposure and grade. Light the first picture in exactly that light, as if photographed at the same moment. Then forbid the rest: not its place, buildings, objects, plants, people, composition, angle or framing.

When the reference is another finished still of the same project (to keep a series matching), say they were photographed minutes apart on the same day by the same camera, with the same light and grain, but that composition, camera position, layout and the positions of objects all come only from the first picture.

### When the model has a short limit

Cut in this order: the people text first, then the fidelity sentence down to its first clause. The light and the closing avoid line stay whole. Always cut at the end of a sentence.

## A small move of the camera

A new angle can only show what the render already shows, so every move is small: a step to one side is a gentle curve of ten to fifteen degrees around the centre, with the same height, lens and aim point, so one side comes forward and the other recedes in natural parallax. A lower view is standing eye height, about 1.6 metres, tilted up a little so walls and trees rise against the sky. A higher view is raised a little and tilted down so water, paving and planting read more clearly. A closer view moves along the line of sight and frames tighter on the centre. Each ends with the same promise: everything in frame is already visible in the reference. A big orbit forces the model to invent the unseen sides, so do not ask for one. The default is the render's own camera, "as rendered", and it is the right choice when a series of stills will later be cut together.

## The looks: words for the light

Each look is one sentence of light, then, if people are in the picture, one of how that light falls on them. Use them as starting points and keep the building's own features in the sentence (its trees, its water, its lamps).

- **No light change.** Keep the render's own light as it is. Use this unless the owner asks for a different hour.
- **Golden hour.** Late sun raking low from the side, warm amber highlights on stone, long soft shadows, gentle backlit glow through leaves, a touch of haze.
- **Early morning.** Just after sunrise: pale gold sun low and clean from the side, cool blue shade, thin mist low over water and between trees, dew on leaves and paving, crisp clear air.
- **Midday sun.** High bright sun, crisp short shadows under trees, eaves and furniture, deep blue sky, true material colour, sparkle on water and glass, vivid greens.
- **Evening.** The sun has just dipped: soft peach-and-rose afterglow, gentle shadowless light wrapping the building, first warm lights coming on, calm reflections.
- **God rays.** Strong low sun through the existing trees and openings into light haze, distinct shafts cutting diagonally, dappled patches where beams land, glowing backlit leaves, cool deep shadows between beams. The beams come only from the real sun direction and real gaps; nothing new is added to make them.
- **Soft overcast.** Bright cloud cover, wrapping diffuse light without harsh shadows, deep saturated greens, a subtle sheen on wet stone.
- **Blue hour.** Just after sunset: deep cobalt sky fading to a warm horizon, lamps on and glowing warm, practical light reflected in water, moody and quiet.
- **After rain.** Glistening wet stone and paving, low mist over water, droplets on leaves, soft silver light breaking through cloud, crisp mirror reflections.
- **Night, lights on.** Dark navy sky, stone grazed by warm uplights so every ridge catches light, water glowing from within, lamps casting warm pools, trees softly lit against the dark, golden reflections across black water, a teal-and-amber night grade.
- **Interior lighting.** The building's own fixtures switched on: warm 2700K light from the real downlights, coves, pendants, wall washers and lamps, soft pools on floors, grazing washes on walls and timber, glowing glass seen from outside, balanced against soft cool daylight or dusk through the windows. The light comes only from fixtures and openings that already exist.
- **Luxury interior.** Layered warm light from the room's real fixtures: dimmed ambient light, hidden coves washing the ceiling, focused accents on art, stone and joinery, a soft glow from lamps, backlit shelves, deep velvety shadows, marble, brass and walnut catching warm highlights, a quiet five-star mood seen at dusk through the windows. Again, nothing new is added.
- **Moonlit night.** A bright full moon behind thin cloud, cool silver-blue light on stone and leaves, a faint low mist on water, dim warm lamps as small accents, deep inky shadows, faint stars.

A light that adds sources the render lacks (god rays, interior light) always carries the sentence that the light comes only from what already exists.

## The grade words

A grade is a sentence of colour and tone, and nothing else. The sentence always ends by saying the light, the architecture, the materials and the contents stay as they are. The twelve:

- **No grade.** Keep the colour as it came out. The usual choice.
- **Clean daylight.** True-to-material: neutral whites, accurate stone, timber and concrete, soft slightly cool shadows, gentle contrast, a long smooth highlight roll-off, like a premium architecture brand film.
- **Warm luxury.** Honeyed highlights, rich warm timber and brass, deep warm blacks, a gentle low-contrast curve, like a five-star resort film.
- **Nordic minimal.** Lightly desaturated, airy and bright, pale greys, muted soft greens, lifted shadows, very low contrast, calm and quiet.
- **Teal and amber.** Warm amber in lit surfaces, cool teal in shadows and sky, kept subtle so materials still read true.
- **Film print.** A motion-picture print look: dense rich blacks, slightly warm mids, gently compressed highlights, organic colour separation, fine even grain.
- **Blue hour luxe.** Deep clean blue in sky and shadows against glowing warm interiors and landscape lighting, crisp contrast between the two, no crushed detail.
- **Golden glow.** Warm golden highlights with a soft bloom, peachy mids, gentle haze, warm open shadows.
- **Moody contrast.** Low key: deeper shadows, sculpted contrast on the architecture, slightly reduced saturation, a dark premium feel, detail kept in the blacks.
- **Bleach bypass.** Silvery and desaturated, strong contrast, metallic highlights, hard-edged shadows, a raw editorial edge on concrete and steel.
- **Soft editorial.** Lifted matte blacks, pastel skies, gentle peach and sage, low contrast, like a magazine spread.
- **Monochrome.** Full tonal range from deep blacks to clean whites, strong form and texture, a light orange-filter response so skies darken slightly.

Ask for one grade per picture, never two. A grade and a changed light together fight each other: pick the light first, then the grade.

## People, if the task asks for them

People are where a re-shoot most often gives itself away. This engine's Artist role decides whether people may appear at all, and by default they do not: a prompt for a clip or a variation names no person. Read this section so you can judge the Art director's notes and any task that asks for people in plain words. When people are asked for, the app walks the model through six things, in this order, each as a positive picture.

1. **How many, and where.** One person for scale; a few (two to four); small groups; a lively but uncrowded scatter with breathing room. Mostly in the midground and foreground, where they read clearly.
2. **Who.** Heritage, age, clothes and what they are doing, as one flowing description, never a stereotype or a costume. The owner's own words about them go in last.
3. **True scale, measured against the scene.** An adult is 1.6 to 1.85 metres. A pool kerb or low planter edge reaches just below the knee. A bench seat sits at knee height. A street lamp is two and a half to three times a person. A mature tree trunk is about as thick as a torso, with the lowest branches above head height. A tall wall towers many times over anyone. People shrink in exact proportion with distance along the paving lines, and standing adults keep their heads near the same eye-level line as the camera.
4. **Body and physics.** Every foot rests on the ground plane, weight on the supporting leg, a balanced stance, a natural stride, seated people resting their full weight, clothes and hair hanging with gravity, hands on real surfaces. They pass correctly in front of or behind trees, planters and lamps, with true reflections near water.
5. **Light and blend.** The look's own light on them, from the same direction, colour and softness as on everything around them. Dark contact shadows where feet meet the ground. Cast shadows with the same direction, length and softness as the trees' and lamps'. Colour bounced onto skin and clothes from stone, foliage and water. Deeper people softened by the same haze as the background, with the same focus falloff as whatever stands at their distance. The same white balance, exposure, contrast, grade, grain and highlight roll-off as the rest of the frame, as if photographed in one instant by one camera.
6. **Real humans.** Distinct individuals with natural asymmetry and small imperfections: uneven skin tone, visible pores, fine lines, freckles, flyaway hair, clear eyes with catchlights from the scene's own light, real fabric weave, correct anatomy, hands with five fingers, relaxed unposed bodies and genuine expressions. Then one short avoid line: no plastic or waxy skin, no airbrushed or uncannily symmetrical faces, no mannequin poses, no cloned faces, no cut-out edges or glow around figures. Keep people clear of the sculptures and the water feature, so the architecture stays the hero.

The lesson the app's makers wrote down most firmly: **people must blend with the light and the background.** Scale against the trees and lamps, and realistic faces, come next. A person who is correct but lit differently looks pasted in, so write the light on people from the same look sentence, never a separate one.

A cast sheet (a picture of real people, sent as a second reference) is explained in one place: the first reference is the scene, the second is a cast sheet. Reproduce its people faithfully, in face, skin tone, hair, build and clothing, at true scale and in the scene's light, and never its own background, lighting, layout or framing.

### Checking people

The app checks every picture that has people on six questions, and says which person fails by position ("the man on the left kerb"). Use the same six when you look at your own work or write notes on someone else's:

1. **Height and scale.** Believable height against what stands beside them, shrinking correctly with distance.
2. **Feet, weight and physics.** No floating, sinking or sliding; balanced poses; clothes and hair obeying gravity.
3. **Light and shadows.** The same direction, colour and softness as the scene; contact and cast shadows matching the trees'; reflections near water.
4. **Faces and hands.** Photographic faces with real skin texture; five fingers; whole bodies with no merged or missing limbs.
5. **Blends with the photo.** Same white balance, exposure, grade, grain, focus and haze as things at the same distance; nothing pasted in, too sharp or too clean.
6. **Scene unchanged.** Compared with the original render, the architecture, trees, lamps, pools, planting and paving are the same, people being the only addition.

A pass needs all six. A failed check is mended by a short positive note for the next try that names the person and the object to measure them against: "make the woman by the second lamp shorter, her head reaching about a third of the lamp's height". Never "fix the scale".

## A clip's prompt

A clip starts exactly on the still and moves the camera a short, calm way. Its prompt is built from these sentences, in this order.

1. "A single continuous, photorealistic cinematic shot that starts exactly on this photograph."
2. **The camera**, one sentence made of three parts: the move, the pace, the manner.
3. **What stays.** Every wall, sculpture, tree, lamp, pool, kerb, plant and paving line stays exactly as in the photograph, rigid and unchanged in shape, number and position, with nothing added or removed.
4. **What moves.** "Only what moves in real life moves": water falls, flows and ripples naturally with true reflections, leaves and branches stir in a light breeze, and the light stays the same throughout.
5. **People.** With none in the frame: "No people or animals appear." With people already in the frame: they move naturally and stay the same people at the same real-world scale, unhurried, weight on each step, feet planted with matching shadows, small relaxed gestures, no one appearing or disappearing. In this engine, the first line is the one you write.
6. **Only what is in the image.** The strict sentence: nothing appears that is not visible in the photograph; no new objects, buildings, furniture, plants, vehicles, people, animals, signs, text, sky features or light sources; the camera never reveals space beyond the edges, so the move is small enough that every frame shows only what the photograph holds. Assume it is on.
7. **The owner's direction**, introduced "Also, using only what is already in the image:".
8. **The ending.** "Smooth, stable, high-end cinema camera footage with natural motion blur and film grain." For a handheld shot: "High-end cinema camera footage with natural motion blur and film grain."

A shotlist prompt is at most 1000 characters here, so compress: keep 1, 2, 3 (short), 4 and 6 in a line each, and drop the rest. The compressed form still opens on the camera and still says what stays.

### The camera moves

Fourteen moves, each short. A move is always small, because the picture is the whole truth about the place.

- **Locked off.** The camera stays completely still on a tripod, exactly framed as the photograph. The scene moves, the camera does not.
- **Push in.** Dolly forward toward the centre of the frame, a short distance only.
- **Pull out.** Dolly back a short distance, staying within what the photograph shows.
- **Track left, track right.** Slide a short distance sideways on a dolly track, with natural parallax between foreground and background.
- **Pan left, pan right.** Stay in place on a fluid head and turn a few degrees, revealing only the continuation of what is already at that edge.
- **Tilt up, tilt down.** Stay in place and tilt a few degrees, revealing only the continuation of what is already at the top edge, or of the ground already at the bottom edge.
- **Crane up, crane down.** Rise or lower a short distance on a crane while tilting the other way to keep the scene centred.
- **Arc left, arc right.** A small curve around the centre of the scene, turning to keep it framed, a few degrees only.
- **Focus pull.** The camera stays still while focus moves smoothly from the foreground to the background.

Pans and tilts are the risky ones, because the new edge has to come from somewhere. That is why the words say "revealing only the continuation". Prefer a track, a push or a locked-off shot when the edges of the picture are busy.

### The manner of the move

One of five, said after the pace.

- **Steady.** On a fully stabilised gimbal, perfectly steady with no shake, wobble or jitter. The usual choice.
- **Linear.** One constant, even speed in a straight mechanical line from the first frame to the last, like a motion-control rig, with no easing.
- **Eased.** Easing in gently from rest, gliding through the middle, easing out to a soft stop.
- **Steadicam float.** On a Steadicam, smooth with a very gentle organic float, never shaky.
- **Handheld.** By a skilled operator, with a subtle natural breathing sway and tiny corrections, never jerky.

A locked-off or focus-only shot has no travel to style, so it gets no manner. Only a handheld camera still breathes there ("held by hand, with only a subtle, natural handheld breathing").

### The pace

- **Very slow:** "very slowly, almost imperceptibly".
- **Slow:** "slowly and calmly". The usual choice, and what the film steps here use.
- **Medium:** "at a moderate, unhurried pace". Still short.

The camera sentence reads like "The camera dollies forward toward the centre of the frame, moving only a short distance, moving slowly and calmly, on a fully stabilised gimbal, perfectly steady with no shake, wobble or jitter."

### The architectural-film sentence

For a film about a building, add one sentence: shot as a high-end architectural film, where the architecture is the hero. The horizon stays perfectly level and every vertical line stays truly vertical and parallel, with no tilt, roll, keystone or lens distortion. One deliberate, motion-control-smooth move from start to finish, no zooming, no shake, no sudden change of direction. Crisp true material detail in stone, timber, glass, metal and planting, natural daylight behaviour, calm and premium like a luxury property film. For a locked-off shot, drop the move: "No zooming and no shake." Leave this sentence out for a handheld shot, because it contradicts the manner.

### A clip that runs between pictures

When the clip is to arrive on a closing picture, say the shot is one continuous move from the opening photograph to the closing frame, arriving exactly on it, and that where the camera move disagrees with the closing frame, the closing frame wins. With middle frames, it passes through each in turn. When extra pictures are only references, say image one is the opening photograph and the shot starts exactly on it; the others are references only, taking from each only what the direction says and adding nothing else. In this engine a clip has one picture, so these sentences matter mainly as a way to read the Art director's notes.

### Negative words

A few video models take a separate list of words to avoid. When the door's model has one and the strict switch is on, it is: new objects, added buildings, furniture, plants or trees, vehicles, new people, animals, birds, text, signage, logos, watermark, new light sources, objects appearing, objects disappearing, morphing, warping geometry, scene change, cut, invented areas beyond the frame. Where the model has no such list, the same words go into the prompt's strict sentence instead.

### How long

Five seconds is the app's usual length. Models differ in the lengths they accept, and the door picks the nearest one. A longer clip gives the model more time to drift, so for a building that must not change, make two short shots rather than one long one.

## Other recipes in the app

**A place from a screenshot.** The Location tab turns a satellite screenshot into a real aerial photograph of that exact spot. The prompt says: keep the exact layout (every footprint, roof shape, road, path, boundary, tree position, water body and piece of terrain stays in place at the same size); keep or set the view (match the screenshot's camera, straight down, or tilted about forty-five degrees from a drone, always a small camera move and the same extent of land); use the coordinates and place name for regional realism (climate zone, season-right planting, soil colour, local roofing and materials, typical vehicles); remove every viewer artefact (labels, pins, watermark, compass, low-poly melting, smeared textures, stitching seams, cloud patches); render crisp texture everywhere; then set the light (match, clear midday, golden hour, soft overcast, blue hour with lit windows and roads). It ends "photoreal, shot from an aircraft or drone with a full-frame camera, natural colour, no text, no illustration, no render look". A short model limit cuts the standing text and never the owner's own direction.

**A film's story.** The Director plans a film from a storyline, and the storylines are the arcs worth borrowing for a shotlist: a day in the life (first light to night, light following the clock); an arrival (approach, entrance, then inside, one time of day throughout, few people); a golden-hour reveal (wide establishing, the strongest views, the most intimate frame last); a luxury resort film (setting, arrival, pools and terraces, finest interiors, dusk and every lamp glowing); architectural purity (no crowds, form and material, from the whole to the detail); a family home story (morning outside, ordinary life inside, the evening with lights on); a lively community (the project in its context, public spaces at their liveliest, people still out in the evening); after dark (evening into blue hour into a full night); a monsoon mood (overcast, then after-rain, then rays as the weather clears); a property showcase (the hero exterior first, a walk from outside in, the best view last). Each order is a way of choosing which render goes in which shot, and which light each shot carries.

## Lessons the app's makers kept

- **People must blend with the light and the background.** Always. See the people section.
- **Never add or assume anything that is not in the image.** The owner's standing demand, and the reason for the strict switch.
- **Frames for a film are shot as rendered.** A film's stills keep the render's own camera unless the owner chose a move; the planner does not pick a camera. Stills that will be cut together must share a viewpoint.
- **Keep the light across a series.** Use the same look, or one finished still as a lighting reference, so cuts do not jump in time of day.
- **A small move is a safe move.** Ten to fifteen degrees, a few degrees, a short distance. Big moves make the model invent.
- **A refused prompt stays refused.** In this engine, never send a refused picture or prompt again; report it, as the role says.
- **Fix with a short positive note.** To mend a failed picture, say what the next try must do, and name the thing to measure it against.

## Checking your own prompt before you send it

- It begins by saying what stays, and names the camera position, framing and layout.
- It names the objects that must not change, and says nothing may be added or removed.
- The light is one sentence and matches a look, or says "keep" the render's own.
- No grade and a changed light are mixed; at most one grade.
- The camera move is small, with its pace and manner, or the shot is locked off.
- No person appears unless the task asked for one in words.
- No words, logo or sign is asked for, and no price or claim.
- It is within the length the shotlist or the batch allows, cut at a sentence, with the owner's own direction kept whole.
