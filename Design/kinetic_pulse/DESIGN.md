---
name: Kinetic Pulse
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c4c9ac'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8e9379'
  outline-variant: '#444933'
  surface-tint: '#abd600'
  primary: '#ffffff'
  on-primary: '#283500'
  primary-container: '#c3f400'
  on-primary-container: '#556d00'
  inverse-primary: '#506600'
  secondary: '#d3fbff'
  on-secondary: '#00363a'
  secondary-container: '#00eefc'
  on-secondary-container: '#00686f'
  tertiary: '#ffffff'
  on-tertiary: '#3c0090'
  tertiary-container: '#e9ddff'
  on-tertiary-container: '#7829ff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c3f400'
  primary-fixed-dim: '#abd600'
  on-primary-fixed: '#161e00'
  on-primary-fixed-variant: '#3c4d00'
  secondary-fixed: '#7df4ff'
  secondary-fixed-dim: '#00dbe9'
  on-secondary-fixed: '#002022'
  on-secondary-fixed-variant: '#004f54'
  tertiary-fixed: '#e9ddff'
  tertiary-fixed-dim: '#d1bcff'
  on-tertiary-fixed: '#23005b'
  on-tertiary-fixed-variant: '#5700c9'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  headline-display:
    fontFamily: Anton
    fontSize: 80px
    fontWeight: '400'
    lineHeight: 80px
    letterSpacing: 0.05em
  headline-lg:
    fontFamily: Anton
    fontSize: 48px
    fontWeight: '400'
    lineHeight: 48px
    letterSpacing: 0.02em
  headline-lg-mobile:
    fontFamily: Anton
    fontSize: 36px
    fontWeight: '400'
    lineHeight: 36px
  body-md:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.1em
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 20px
  margin-desktop: 64px
  container-max: 1440px
---

## Brand & Style

The design system is engineered to capture the high-frequency energy of a summer outdoor techno festival. It departs from traditional utility to embrace an immersive, "electric" atmosphere defined by motion and light. The brand personality is aggressive, nocturnal, and avant-garde, targeting an audience that seeks sensory-heavy experiences.

The visual style is a hybrid of **High-Contrast Bold** and **Glassmorphism**, infused with **Brutalist** structural elements. It prioritizes the "rave flyer" aesthetic—utilizing extreme contrast, light-leak gradients, and digital distortion motifs to mimic the visual overload of a main stage at midnight. Every interaction should feel kinetic, using motion blur and glowing states to suggest a state of constant vibration.

## Colors

The palette is anchored in a "Void Black" (`#050505`) to create maximum depth, allowing neon accents to "pop" with optical vibration. 

- **Primary (Acid Yellow):** Used for critical calls to action and headline accents. It should feel radioactive and high-visibility.
- **Secondary (Electric Blue):** Represents the technical side of the festival; used for interactive states, borders, and secondary highlights.
- **Tertiary (Ultraviolet):** Introduced via gradients and background blurs to simulate stage lighting and "atmospheric haze."

Gradients should be used sparingly as "light beams" (linear, sharp) or "ambient glow" (radial, highly diffused). Backgrounds are never flat; they utilize subtle noise textures to prevent banding in the dark gradients.

## Typography

Typography in this design system is treated as a rhythmic element. **Anton** is the dominant voice, always utilized in uppercase to command attention. To lean into the "distorted" aesthetic, Display and Large Headlines should be italicized and given wide tracking (`0.05em`) to simulate forward momentum.

**Space Grotesk** provides a clean, technical contrast for body copy, ensuring legibility against complex backgrounds. **Space Mono** is reserved for metadata, timestamps, and "technical data" labels, reinforcing the precision of electronic music production. Use "glitch" styling—such as horizontal offsets or staggered line heights—for section headers to break the grid.

## Layout & Spacing

This design system employs a **Fluid Grid** with a 12-column structure for desktop and a 4-column structure for mobile. However, the placement of elements should feel intentional and slightly "off-beat" to mirror the syncopation of techno.

Spacing is tight and dense, using a 4px base unit. Margins are generous on the outer edges to create a "stage" effect for the central content. Use overlapping containers and asymmetrical alignment to break the standard SaaS-style verticality. Content reflow on mobile should prioritize large-scale imagery and high-impact typography over information density.

## Elevation & Depth

Depth is achieved through **Glassmorphism** and **Light Emission** rather than traditional shadows. 

1.  **Glass Layers:** Use semi-transparent surfaces (10-20% opacity) with a heavy backdrop blur (20px-40px). This mimics the look of plexiglass or fogged-up venue windows.
2.  **Neon Outlines:** Instead of shadows, use 1px or 2px solid strokes of Acid Yellow or Electric Blue to define the edges of elevated containers.
3.  **Backglow:** High-priority cards should emit a soft, tinted radial glow (shadow-spread) that matches the border color, simulating a light source behind the element.
4.  **Glitch Separators:** Use 1px horizontal lines with "missing segments" or slight color-fringing (RGB split) to separate sections.

## Shapes

The shape language is strictly **Sharp (0)**. Everything from buttons to image containers and cards uses 0px corner radii. This creates a raw, aggressive, and industrial feel consistent with techno culture. In rare instances where "softness" is required for accessibility (like small circular avatars), the sharp grid should still frame the element to maintain visual consistency.

## Components

- **Buttons:** Large, rectangular, and high-impact. Primary buttons are solid Acid Yellow with black text. Secondary buttons use a 2px neon blue outline with a glass-blur background. Hover states should trigger a "glitch" flicker or a rapid color-invert.
- **Cards:** Defined by "frosted" transparency. Headers within cards should use the `label-sm` font in a contrasting color bar.
- **Chips/Tags:** Small, sharp rectangles with monospaced text. Use these for genre tags (e.g., [INDUSTRIAL], [AMBIENT]).
- **Input Fields:** Minimalist. A single 1px bottom border that glows Electric Blue when focused. Use `Space Mono` for input text to give it a "terminal" feel.
- **Lists:** Borderless. Items are separated by subtle "scanline" textures or low-opacity horizontal rules.
- **Specialty Component: "The Strobe":** A progress bar or loading state that uses high-frequency flashing between two neon colors or a rapidly moving light-leak gradient.