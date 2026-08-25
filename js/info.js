// ---- StueveCast: field explanations (ported verbatim from S2, with model-data notes) ----

const FIELD_INFO = {

lcl: {
  label: 'LCL — Lifting Condensation Level',
  hover: 'The height a rising air parcel must reach before it becomes saturated and starts to condense — the theoretical cloud base.',
  derivation: `<p>The LCL is calculated from the surface temperature and dewpoint using
    Bolton's (1980) widely-used empirical approximation:</p>
    <p style="text-align:center;font-style:italic;">T<sub>LCL</sub> = 1 / (1/(T<sub>d</sub>−56) + ln(T/T<sub>d</sub>)/800) + 56</p>
    <p>where T and T<sub>d</sub> are the surface temperature and dewpoint in Kelvin. The
    corresponding pressure is then found by lifting the parcel dry-adiabatically
    (following the Poisson equation) from the surface until it reaches that
    temperature.</p>`,
  meaning: `<p>As unsaturated air rises, it cools at the dry adiabatic lapse rate
    (~9.8 °C/km) while its dewpoint falls much more slowly (~1.8 °C/km). The
    LCL is the height at which these two curves meet — the parcel is now
    saturated. Physically, this is the altitude at which cumulus cloud bases
    typically form when surface air is lifted (by heating, a front, or
    terrain), since condensation begins there.</p>`,
  interpretation: `<p>A <b>low LCL</b> (roughly below 1000–1500 m AGL) indicates a moist
    boundary layer and favors low cloud bases; combined with strong lift, this
    also increases the risk of low-based, higher-precipitation-efficiency
    storms and reduces visibility under cloud. A <b>high LCL</b> (above ~2500 m
    AGL) indicates a dry sub-cloud layer — common in continental, high-based
    storm environments — which favors stronger downdrafts and gusty, dry
    outflow beneath storms, since evaporating rain cools the descending air
    over a longer distance.</p>`,
  links: [
    {label:'AMS Glossary — Lifting condensation level', url:'https://glossary.ametsoc.org/wiki/Lifting_condensation_level'},
    {label:'Bolton (1980), Monthly Weather Review — original formula', url:'https://journals.ametsoc.org/view/journals/mwre/108/7/1520-0493_1980_108_1046_tcoept_2_0_co_2.xml'},
    {label:'Wikipedia — Lifted condensation level', url:'https://en.wikipedia.org/wiki/Lifted_condensation_level'},
  ],
},

lfc: {
  label: 'LFC — Level of Free Convection',
  hover: 'The height above the LCL where a rising parcel finally becomes warmer than its surroundings — where positive buoyancy (CAPE) actually begins.',
  derivation: `<p>Starting at the LCL, the parcel is lifted further along a moist
    (pseudoadiabatic) adiabat, since it is now saturated. At every level its
    temperature is compared to the environment's measured temperature. The
    LFC is the first level at or above the LCL where the parcel becomes
    warmer than the environment — i.e. where its buoyancy first turns
    positive.</p>`,
  meaning: `<p>Between the LCL and the LFC, a lifted parcel is typically still
    <i>colder</i> than its environment (unless there is no cap at all, in
    which case the LFC coincides with the LCL). This layer of negative
    buoyancy is exactly what CIN measures. Only once the parcel passes the
    LFC does it accelerate upward on its own — this is the base of the CAPE
    layer, and conceptually the boundary between "air that needs to be
    forced up" and "air that will rise by itself".</p>`,
  interpretation: `<p>An LFC close to the LCL means there is little or no capping
    inversion — convection can begin easily once the LCL is reached, so
    isolated heating or weak lift can trigger showers or storms. An LFC well
    above the LCL indicates a capping layer (an inversion or a dry layer)
    that must be overcome first — often by daytime heating, a front, or
    orographic lift — before storms can develop. Very high or unreachable
    LFCs (marked "not reached" here) mean the sounding, as measured, does
    not support free convection at all.</p>`,
  links: [
    {label:'AMS Glossary — Level of free convection', url:'https://glossary.ametsoc.org/wiki/Level_of_free_convection'},
    {label:'NWS JetStream — Convective parameters overview', url:'https://www.weather.gov/jetstream/stability'},
  ],
},

cape: {
  label: 'CAPE — Convective Available Potential Energy',
  hover: 'The total energy available to a rising air parcel above the LFC — the fuel supply for thunderstorm updrafts.',
  derivation: `<p>CAPE is the vertical integral of positive buoyancy between the LFC
    and the equilibrium level (where the parcel again becomes colder than the
    environment), computed here for a surface-based parcel without a
    virtual-temperature correction:</p>
    <p style="text-align:center;font-style:italic;">CAPE = ∫ g · (T<sub>parcel</sub> − T<sub>env</sub>) / T<sub>env</sub> dz</p>
    <p>integrated over all layers where the bracketed term is positive (in
    Kelvin, with g = 9.80665 m/s²).</p>`,
  meaning: `<p>CAPE represents the kinetic energy a parcel could theoretically gain
    rising freely from the LFC to the equilibrium level, assuming no
    entrainment or drag. It is directly related to the maximum possible
    updraft speed via w<sub>max</sub> ≈ √(2·CAPE) — though real updrafts are
    always weaker due to entrainment, precipitation loading, and mixing.</p>`,
  interpretation: `<p>Commonly used (approximate) categories:</p>
    <table class="im-table"><tr><th>CAPE (J/kg)</th><th>Instability</th></tr>
    <tr><td>0 – 300</td><td>Weak / marginal</td></tr>
    <tr><td>300 – 1000</td><td>Moderate</td></tr>
    <tr><td>1000 – 2500</td><td>Strong</td></tr>
    <tr><td>&gt; 2500</td><td>Extreme</td></tr></table>
    <p>High CAPE alone doesn't guarantee storms — a trigger (lift) is still
    needed to get a parcel to its LFC, especially if CIN is also large.</p>`,
  links: [
    {label:'AMS Glossary — CAPE', url:'https://glossary.ametsoc.org/wiki/Convective_available_potential_energy'},
    {label:'SPC Mesoanalysis — CAPE parameters', url:'https://www.spc.noaa.gov/exper/mesoanalysis/help/help_cape.html'},
    {label:'Wikipedia — Convective available potential energy', url:'https://en.wikipedia.org/wiki/Convective_available_potential_energy'},
  ],
},

cin: {
  label: 'CIN — Convective Inhibition',
  hover: 'The energy barrier a parcel must overcome (via lift) before it can reach its LFC and rise freely.',
  derivation: `<p>CIN is the same buoyancy integral as CAPE, but summed over the
    layers <i>below</i> the LFC where the parcel is colder than the
    environment (negative buoyancy):</p>
    <p style="text-align:center;font-style:italic;">CIN = ∫ g · (T<sub>parcel</sub> − T<sub>env</sub>) / T<sub>env</sub> dz</p>
    <p>integrated only where the term is negative; the result is reported here
    as a positive magnitude in J/kg.</p>`,
  meaning: `<p>CIN quantifies how much external lifting energy — from surface
    heating, a front, terrain, or a convergence line — is needed to push a
    parcel up to the level where it becomes buoyant on its own. It behaves
    like a "lid" on convection.</p>`,
  interpretation: `<p>Low CIN (roughly under 25–50 J/kg) is usually overcome easily by
    daytime heating. Moderate to high CIN can suppress storms for hours even
    with large CAPE present — sometimes called a "loaded gun" sounding,
    since if the cap does eventually break (or is removed by strong forcing),
    the stored CAPE can be released abruptly, favoring more intense
    storms.</p>`,
  links: [
    {label:'AMS Glossary — Convective inhibition', url:'https://glossary.ametsoc.org/wiki/Convective_inhibition'},
    {label:'NWS JetStream — Convective inhibition', url:'https://www.weather.gov/jetstream/cape'},
  ],
},

dcape: {
  label: 'DCAPE — Downdraft CAPE',
  hover: 'The energy available to a sinking, evaporatively-cooled parcel — an indicator of downdraft and gust-front strength.',
  derivation: `<p>The level of minimum equivalent potential temperature (θ<sub>e</sub>)
    within the lowest 400 hPa is found first — this dry, mid-level air is the
    typical source of a downdraft. A saturated parcel is then brought down
    from that level to the surface along the same moist adiabat (evaporative
    cooling keeps it saturated during descent), and the resulting negative
    buoyancy relative to the environment is integrated downward, analogous to
    CAPE but for a sinking parcel. This implementation follows the standard
    simplified approach (e.g. Emanuel, 1994) without entrainment.</p>`,
  meaning: `<p>As precipitation falls into drier air below cloud base, it
    evaporates and cools that air, making it denser than its surroundings —
    this negatively buoyant air accelerates downward, reaching the surface as
    a downdraft. DCAPE approximates the maximum energy available to that
    process from this single sounding.</p>`,
  interpretation: `<p>DCAPE above roughly 800–1000 J/kg suggests the potential for strong,
    gusty downdrafts and outflow winds if a storm does form nearby — relevant
    for gust-front and (in extreme cases) microburst risk. Lower values
    suggest comparatively weaker downdraft potential.</p>`,
  links: [
    {label:'AMS Glossary — Downdraft CAPE', url:'https://glossary.ametsoc.org/wiki/Downdraft_CAPE'},
    {label:'COMET/MetEd — Downbursts and microbursts (overview)', url:'https://en.wikipedia.org/wiki/Microburst'},
  ],
},

pw: {
  label: 'Precipitable Water',
  hover: 'The total depth of liquid water if every drop of vapor in the column above were condensed out — an upper bound on rainfall from that column.',
  derivation: `<p>Precipitable water is the vertical integral of the actual (not
    saturation) mixing ratio through the whole measured column:</p>
    <p style="text-align:center;font-style:italic;">PW = (1/g) ∫ w dp</p>
    <p>where w is the dewpoint-derived mixing ratio at each level and the
    integral is taken over pressure. The result, in kg/m², is numerically
    identical to millimeters of liquid water depth.</p>`,
  meaning: `<p>PW measures how much moisture the entire atmospheric column
    currently holds. It does not by itself say whether that moisture will be
    released as precipitation — it needs to be combined with lift,
    instability, or a very efficient rain process (e.g. "training" storms) —
    but it sets an upper ceiling on the total rainfall a single pass of
    weather could produce from that airmass.</p>`,
  interpretation: `<p>Typical values range from a few mm in cold, dry (continental
    winter) air masses up to 40–60+ mm in warm, tropical or monsoon airmasses.
    Values well above the local climatological normal for the season are a
    classic ingredient (alongside strong lift) for heavy-rainfall and
    flash-flood setups.</p>`,
  links: [
    {label:'AMS Glossary — Precipitable water', url:'https://glossary.ametsoc.org/wiki/Precipitable_water'},
    {label:'Wikipedia — Precipitable water', url:'https://en.wikipedia.org/wiki/Precipitable_water'},
  ],
},

freezeLevel: {
  label: 'Freezing Level',
  hover: 'The lowest altitude at which the measured temperature crosses 0 °C on the way up.',
  derivation: `<p>Found directly from the measured temperature profile: the first
    pair of consecutive readings where temperature crosses from above to
    below 0 °C, linearly interpolated between them for both pressure and
    altitude.</p>`,
  meaning: `<p>The freezing level marks where ice processes become relevant in
    clouds above it, and is the reference level used for icing forecasts in
    aviation and for rain/snow-level guidance in surface weather forecasting.
    It typically also marks roughly where the melting layer sits in
    stratiform precipitation (visible as a "bright band" on weather radar).</p>`,
  interpretation: `<p>A low freezing level (e.g. under 1500–2000 m in temperate
    latitudes) increases the chance of snow reaching lower elevations and
    of airframe icing at modest altitudes. A high freezing level (well above
    3000–4000 m) favors rain rather than snow even at higher elevations, and
    is often associated with warmer, more tropical or subtropical air
    masses.</p>`,
  links: [
    {label:'AMS Glossary — Freezing level', url:'https://glossary.ametsoc.org/wiki/Freezing_level'},
    {label:'FAA — Aircraft icing overview', url:'https://www.weather.gov/source/zhu/ZHU_Training_Page/icing_stuff/icing/icing.htm'},
  ],
},

tropopause: {
  label: 'Tropopause',
  hover: 'The boundary between the troposphere (where weather happens) and the stratosphere above it.',
  derivation: `<p>Detected using the WMO's standard lapse-rate definition: the lowest
    level at which the average lapse rate between it and all levels within
    the next 2 km above drops to 2 °C/km or less, sustained over that layer.
    This is the same operational definition used for radiosonde analysis
    worldwide.</p>`,
  meaning: `<p>Below the tropopause, temperature generally decreases with height
    (driving vertical mixing and "weather"); above it, in the stratosphere,
    temperature is roughly constant or increases with height, which strongly
    suppresses vertical motion. Rising thunderstorm tops characteristically
    flatten out into an anvil right at or just below the tropopause, since
    the stable stratosphere above resists further ascent.</p>`,
  interpretation: `<p>Tropopause height varies systematically with latitude and season —
    roughly 16–18 km in the tropics, 10–12 km in mid-latitudes, and as low as
    7–9 km in polar winter air masses. A tropopause reported as "not reached"
    simply means the balloon's flight ended (burst) before the profile
    satisfied the lapse-rate criterion.</p>`,
  links: [
    {label:'AMS Glossary — Tropopause', url:'https://glossary.ametsoc.org/wiki/Tropopause'},
    {label:'Wikipedia — Tropopause', url:'https://en.wikipedia.org/wiki/Tropopause'},
  ],
},

thunderstorm: {
  label: 'Thunderstorm Chance (K-Index)',
  hover: 'A classic index combining mid-level lapse rate and low/mid-level moisture into a single thunderstorm-likelihood estimate.',
  derivation: `<p>The K-Index (George, 1960) is computed from temperature and dewpoint
    at three standard pressure levels, interpolated from the sounding:</p>
    <p style="text-align:center;font-style:italic;">K = (T<sub>850</sub> − T<sub>500</sub>) + T<sub>d,850</sub> − (T<sub>700</sub> − T<sub>d,700</sub>)</p>
    <p>The first term is the 850–500 hPa lapse rate (instability), the second
    is low-level moisture, and the third penalizes a dry layer at 700 hPa.
    The resulting K value is mapped here to an approximate thunderstorm
    probability using George's original lookup table.</p>`,
  meaning: `<p>Unlike CAPE, the K-Index needs no parcel lifting calculation — it is
    a simple, purely diagnostic combination of moisture and lapse rate at
    fixed levels, which made it popular before routine automated
    parcel-theory calculations were common. It works best for assessing
    airmass (non-severe, "garden variety") thunderstorm potential and is
    less reliable for frontal or severe/organized convection.</p>`,
  interpretation: `<p>George's (1960) original categories:</p>
    <table class="im-table"><tr><th>K-Index</th><th>Thunderstorm probability</th></tr>
    <tr><td>&lt; 20</td><td>None</td></tr>
    <tr><td>20 – 25</td><td>Isolated</td></tr>
    <tr><td>26 – 30</td><td>Widely scattered</td></tr>
    <tr><td>31 – 35</td><td>Scattered</td></tr>
    <tr><td>&gt; 35</td><td>Numerous</td></tr></table>`,
  links: [
    {label:'AMS Glossary — K index', url:'https://glossary.ametsoc.org/wiki/K_index'},
    {label:'George, J.J. (1960), Weather Forecasting for Aeronautics', url:'https://en.wikipedia.org/wiki/K-index'},
  ],
},

cloudCover: {
  label: 'Cloud Cover (estimated)',
  hover: 'An estimated total sky cover, derived from the humidity profile, expressed as a percentage, octas, and the matching METAR abbreviation.',
  derivation: `<p>For each level, a cloud-fraction is estimated from relative humidity
    once RH exceeds 80% (roughly (RH−80)²/400), reflecting that clouds don't
    form abruptly at 100% RH in a coarse vertical profile. These per-level
    fractions are then combined using random overlap (1 − Π(1 − C<sub>i</sub>))
    to give a single total-cover estimate, which is converted to eighths of
    sky ("octas") and to the standard METAR abbreviation.</p>`,
  meaning: `<p>This is a proxy, not a direct cloud observation — an actual sonde
    only measures temperature, humidity, and pressure, not cloud droplets
    directly. The octas scale (0–8) and METAR abbreviations are the standard
    international convention for reporting sky cover:</p>
    <table class="im-table"><tr><th>Octas</th><th>METAR</th><th>Meaning</th></tr>
    <tr><td>0</td><td>SKC</td><td>Sky clear</td></tr>
    <tr><td>1–2</td><td>FEW</td><td>Few clouds</td></tr>
    <tr><td>3–4</td><td>SCT</td><td>Scattered</td></tr>
    <tr><td>5–7</td><td>BKN</td><td>Broken</td></tr>
    <tr><td>8</td><td>OVC</td><td>Overcast</td></tr></table>`,
  interpretation: `<p>Treat this as a rough, single-profile indicator of how saturated the
    column is overall — useful as a quick sanity check alongside the
    continuous humidity shading on the main diagram, but not a substitute for
    an actual satellite or surface cloud observation.</p>`,
  links: [
    {label:'AMS Glossary — Sky cover', url:'https://glossary.ametsoc.org/wiki/Sky_cover'},
    {label:'Wikipedia — METAR (cloud cover codes)', url:'https://en.wikipedia.org/wiki/METAR#Cloud_reporting'},
  ],
},

shear: {
  label: '0–6 km Bulk Wind Shear',
  hover: 'The vector difference in wind between the surface and 6 km above ground — a key ingredient for storm organization.',
  derivation: `<p>Computed as the vector difference between the wind at the lowest
    measured level and the wind nearest 6 km above the launch-site elevation:</p>
    <p style="text-align:center;font-style:italic;">Shear = √((u<sub>6km</sub> − u<sub>sfc</sub>)² + (v<sub>6km</sub> − v<sub>sfc</sub>)²)</p>
    <p>using the standard meteorological wind-vector (u,v) components derived
    from each level's speed and direction.</p>`,
  meaning: `<p>Bulk shear describes how much the wind changes across the depth of a
    typical thunderstorm updraft. Strong shear tilts an updraft so that
    precipitation doesn't fall directly back through it, letting storms
    persist and organize into longer-lived, more structured systems rather
    than the short-lived, disorganized "pulse" storms that form in weak-shear
    environments.</p>`,
  interpretation: `<p>Approximate, widely-cited thresholds for 0–6 km shear:</p>
    <table class="im-table"><tr><th>Shear</th><th>Typical organization</th></tr>
    <tr><td>&lt; 20 kt</td><td>Weak — disorganized, short-lived cells</td></tr>
    <tr><td>20 – 35 kt</td><td>Moderate — organized multicells</td></tr>
    <tr><td>&gt; 35–40 kt</td><td>Strong — supercell potential (if CAPE also sufficient)</td></tr></table>
    <p>Shear and instability (CAPE) work together — strong shear with little
    CAPE, or vice versa, both limit severe storm potential.</p>`,
  links: [
    {label:'AMS Glossary — Vertical wind shear', url:'https://glossary.ametsoc.org/wiki/Vertical_wind_shear'},
    {label:'SPC Mesoanalysis — Shear parameters', url:'https://www.spc.noaa.gov/exper/mesoanalysis/help/help_shr6.html'},
  ],
},

li: {
  label: 'Lifted Index (LI)',
  hover: 'The temperature difference between the environment and a surface parcel lifted to 500 hPa — negative values mean instability.',
  derivation: `<p>Introduced by Galway (1956), the Lifted Index is simply:</p>
    <p style="text-align:center;font-style:italic;">LI = T<sub>500,env</sub> − T<sub>500,parcel</sub></p>
    <p>where T<sub>500,parcel</sub> is the temperature a surface parcel would
    have if lifted dry-adiabatically to its LCL and then moist-adiabatically
    the rest of the way to 500 hPa, and T<sub>500,env</sub> is the actual
    measured temperature there.</p>`,
  meaning: `<p>LI is essentially a single-level shortcut for the same idea behind
    CAPE: if the lifted parcel ends up warmer than its environment at 500 hPa
    (LI negative), that layer is unstable for a rising parcel; if colder (LI
    positive), it's stable. Because it only checks one level, it's simpler
    and faster to compute than integrating CAPE through the whole column, but
    also less complete.</p>`,
  interpretation: `<p>Commonly used categories (Galway, 1956; widely adopted since):</p>
    <table class="im-table"><tr><th>LI (°C)</th><th>Stability</th></tr>
    <tr><td>&gt; 0</td><td>Stable</td></tr>
    <tr><td>0 to −2</td><td>Marginally unstable</td></tr>
    <tr><td>−2 to −6</td><td>Moderately unstable</td></tr>
    <tr><td>&lt; −6</td><td>Very unstable</td></tr></table>`,
  links: [
    {label:'AMS Glossary — Lifted index', url:'https://glossary.ametsoc.org/wiki/Lifted_index'},
    {label:'Galway, J.G. (1956), Bulletin of the AMS — original paper', url:'https://en.wikipedia.org/wiki/Lifted_index'},
  ],
},

inversions: {
  label: 'Inversions',
  hover: 'Layers where temperature increases with height instead of the usual decrease — a "lid" on vertical mixing.',
  derivation: `<p>Detected directly from the temperature profile: any sustained layer
    where temperature rises with increasing altitude (the reverse of the
    normal tropospheric lapse). Each detected layer's midpoint pressure is
    converted to altitude in the currently selected unit.</p>`,
  meaning: `<p>Because warmer air normally sits above cooler air in a stable
    atmosphere, an inversion is a strongly stable layer: air parcels reaching
    it strongly resist further vertical motion. Inversions form in several
    ways — radiative cooling of the surface overnight, subsidence in
    high-pressure systems, or warm air overrunning a cooler layer at a front
    — and each has different implications.</p>`,
  interpretation: `<p>Inversions trap moisture, smoke, and pollutants beneath them (a
    classic cause of poor air quality and valley fog), and can act as a
    capping layer that suppresses or delays convection (see CIN) until it
    erodes with daytime heating. For balloon flights specifically, a strong
    inversion can also correspond to a temporary change in ascent rate as the
    balloon crosses a layer of very different air density.</p>`,
  links: [
    {label:'AMS Glossary — Temperature inversion', url:'https://glossary.ametsoc.org/wiki/Temperature_inversion'},
    {label:'Wikipedia — Inversion (meteorology)', url:'https://en.wikipedia.org/wiki/Inversion_(meteorology)'},
  ],
},

isothermal: {
  label: 'Isothermal Layers',
  hover: 'Layers where temperature stays roughly constant with height — a borderline-stable transition zone.',
  derivation: `<p>Detected from the temperature profile as sustained layers where
    temperature changes very little with height (in between a normal
    decreasing lapse rate and a true inversion). Each detected layer's
    midpoint pressure is converted to altitude in the currently selected
    unit.</p>`,
  meaning: `<p>An isothermal layer is a special case of a stable layer — since
    temperature isn't falling with height, a lifted parcel (which cools as it
    rises) quickly becomes colder than its surroundings, so these layers also
    resist vertical motion, though usually less strongly than a true
    inversion. They often mark the top of a well-mixed boundary layer, a
    frontal transition zone, or — near the top of a sounding — the approach
    to the tropopause.</p>`,
  interpretation: `<p>Like inversions, isothermal layers can locally slow a balloon's
    ascent rate and are worth noting when interpreting anomalies in the rise-speed
    profile. Multiple stacked isothermal or inverted layers often indicate a
    complex, multi-airmass sounding (e.g. a residual layer from the previous
    day sitting above the fresh boundary layer).</p>`,
  links: [
    {label:'AMS Glossary — Isothermal layer', url:'https://glossary.ametsoc.org/wiki/Isothermal_layer'},
  ],
},

analyticalComments: {
  label: 'Analytical Comments',
  hover: 'A plain-language traffic-light summary of rain risk and thunderstorm risk, derived from the fields above.',
  derivation: `<p>This section combines several of the fields above into two separate,
    automated qualitative assessments:</p>
    <p><b>Rain risk</b> uses estimated cloud cover and precipitable water:
    🔴 high if cloud cover ≥ 85% and PW ≥ 30 mm; 🟡 moderate if cloud cover ≥ 50%
    or PW ≥ 20 mm; 🟢 low otherwise.</p>
    <p><b>Thunderstorm risk</b> uses the K-Index-derived probability and CAPE
    (with a DCAPE note added when relevant): 🔴 high if the K-Index probability
    is ≥ 60% or CAPE ≥ 1000 J/kg; 🟡 moderate if ≥ 30% or CAPE ≥ 300 J/kg;
    🟢 low otherwise. If DCAPE ≥ 800 J/kg, a note about downdraft/gust potential
    is appended.</p>`,
  meaning: `<p>Rain risk here specifically means general/stratiform precipitation
    potential — driven by how much moisture is in the column and how saturated
    it already is — which is a different physical process from thunderstorm
    risk, which depends on instability and lift (CAPE, K-Index) rather than
    moisture alone. A sounding can show high rain risk with low thunderstorm
    risk (a moist, stable, overcast airmass) or the reverse (a dry, unstable
    airmass where storms are possible but only where triggered).</p>`,
  interpretation: `<p>Treat both indicators as a fast, single-sounding sanity check —
    exactly the kind of first read a forecaster does before digging into the
    individual numbers — not a substitute for an actual forecast, which would
    also weigh model guidance, satellite imagery, and the wider synoptic
    situation.</p>`,
  links: [
    {label:'AMS Glossary — Airmass thunderstorm', url:'https://glossary.ametsoc.org/wiki/Airmass_thunderstorm'},
  ],
},

};

const FIELD_ACTUAL = {
  lcl: (ctx)=>{
    const t = ctx.t;
    return `<p>For this profile, the LCL works out to <b>${Math.round(t.lcl.p)} hPa</b>
      (${formatAltitude(altitudeAtPressureSafe(ctx, t.lcl.p), ctx.groundAltM)}),
      at a temperature of ${t.lcl.T.toFixed(1)} °C. ${
      (t.lcl.p > (t.p0-150)) ?
        'That is fairly close to the surface pressure, indicating a moist boundary layer and a low expected cloud base.' :
        (t.lcl.p < (t.p0-350) ?
          'That is well above the surface, indicating a fairly dry sub-cloud layer and a higher expected cloud base.' :
          'That is a moderate distance above the surface — a fairly typical cloud-base height for this kind of profile.')
      }</p>`;
  },
  lfc: (ctx)=>{
    const t = ctx.t;
    if(t.lfcP==null) return `<p>No LFC was found in this sounding — the profile as measured never
      supports free convection, regardless of any lift applied to a surface parcel.</p>`;
    const gap = t.lcl.p - t.lfcP;
    return `<p>The LFC sits at <b>${Math.round(t.lfcP)} hPa</b>, ${gap<10?'essentially at the LCL':
      gap<80?'a modest distance above the LCL':'well above the LCL'} (LCL: ${Math.round(t.lcl.p)} hPa).
      ${gap<10 ? 'With little or no gap, there is effectively no capping inversion — convection could begin readily once the LCL is reached.' :
        gap<80 ? 'This modest gap corresponds to the CIN of '+Math.round(t.cin)+' J/kg computed for this profile — a cap that daytime heating or modest lift could plausibly overcome.' :
        'This large gap corresponds to the CIN of '+Math.round(t.cin)+' J/kg computed for this profile — a substantial cap that would need strong forcing to break.'}</p>`;
  },
  cape: (ctx)=>{
    const c = ctx.t.cape;
    const cat = c<300?'weak/marginal':c<1000?'moderate':c<2500?'strong':'extreme';
    return `<p>This profile's surface-based CAPE is <b>${Math.round(c)} J/kg</b>, which falls in the
      <b>${cat}</b> category by the standard ranges above. ${
      c<50 ? 'This is close to zero — the profile is essentially stable for a surface-based parcel.' :
      c<300 ? 'Only limited buoyant energy is available even if convection is triggered.' :
      c<1000 ? 'A meaningful amount of energy is available; showers or thunderstorms, if triggered, could develop real updraft strength.' :
      'A large amount of energy is available — if convection is triggered, it has the potential to become vigorous.'
      }</p>`;
  },
  li: (ctx)=>{
    const li = ctx.t.li;
    if(li==null) return `<p>The sounding doesn't reach 500 hPa, so a Lifted Index couldn't be computed for this profile.</p>`;
    const cat = li>0?'stable':li>-2?'marginally unstable':li>-6?'moderately unstable':'very unstable';
    return `<p>This profile's Lifted Index is <b>${li>0?'+':''}${li.toFixed(1)} °C</b>, which falls in the
      <b>${cat}</b> category by Galway's original ranges. ${
      li>0 ? 'A surface parcel lifted to 500 hPa would end up colder than its environment there — this layer resists free convection.' :
      'A surface parcel lifted to 500 hPa would end up warmer than its environment there, consistent with the CAPE value of '+Math.round(ctx.t.cape)+' J/kg computed for the same profile.'
      }</p>`;
  },
  cin: (ctx)=>{
    const cin = ctx.t.cin;
    return `<p>CIN for this profile is <b>${Math.round(cin)} J/kg</b>. ${
      cin<25 ? 'That is low enough to be overcome easily by ordinary daytime heating or weak lift.' :
      cin<100 ? 'That is a moderate cap — noticeable, but plausibly breakable with typical daytime heating or a modest lifting mechanism.' :
      'That is a substantial cap — this profile would likely need strong forcing (a front, strong heating, or orographic lift) to initiate convection at all.'
      }</p>`;
  },
  dcape: (ctx)=>{
    const d = ctx.dcape;
    if(d==null) return `<p>DCAPE could not be computed for this profile (insufficient data in the lowest 400 hPa).</p>`;
    return `<p>DCAPE for this profile is <b>${Math.round(d)} J/kg</b>. ${
      d<400 ? 'That suggests comparatively limited downdraft potential from this profile.' :
      d<800 ? 'That is a moderate value — some gusty outflow potential if a storm does form nearby.' :
      'That is a high value — this profile favors strong, gusty downdrafts and outflow winds if a storm forms nearby.'
      }</p>`;
  },
  pw: (ctx)=>{
    const p = ctx.pw;
    return `<p>Precipitable water for this column is <b>${p.toFixed(1)} mm</b>. ${
      p<15 ? 'That is a fairly dry column overall, typical of cold or continental airmasses — the ceiling on possible rainfall from this airmass alone is low.' :
      p<30 ? 'That is a moderate value, unremarkable for a temperate-latitude warm season airmass.' :
      'That is a notably moist column — if strong lift or a very efficient rain process is also present, this level of PW supports heavy-rainfall potential.'
      }</p>`;
  },
  freezeLevel: (ctx)=>{
    const t = ctx.t;
    if(t.freezeAlt==null) return `<p>No freezing level was found — the entire measured profile stayed at or above 0 °C.</p>`;
    return `<p>The freezing level for this profile is at <b>${formatAltitude(t.freezeAlt, ctx.groundAltM)}</b>
      (${Math.round(t.freezeAlt)} m MSL). ${
      t.freezeAlt < 1500 ? 'That is quite low — any precipitation reaching the surface has a good chance of falling as snow even at modest elevations.' :
      t.freezeAlt < 3000 ? 'That is a fairly typical mid-latitude value for a temperate-season sounding.' :
      'That is a high freezing level, consistent with a warm, often subtropical or summertime airmass — precipitation is very likely to remain rain down to the surface.'
      }</p>`;
  },
  tropopause: (ctx)=>{
    const t = ctx.t;
    if(t.tropoAlt==null) return `<p>The tropopause wasn't reached — the profile (or the lapse-rate criterion) ended before the profile satisfied the WMO definition.</p>`;
    return `<p>The tropopause for this profile was found at <b>${formatAltitude(t.tropoAlt, ctx.groundAltM)}</b>
      (${Math.round(t.tropoAlt)} m MSL, ${Math.round(t.tropoP)} hPa). ${
      t.tropoAlt < 9500 ? 'That is on the low side for mid-latitudes, more typical of a polar or cold-season airmass.' :
      t.tropoAlt < 12500 ? 'That sits in the typical mid-latitude range.' :
      'That is on the high side for mid-latitudes, more typical of a warm, subtropical-influenced airmass.'
      }</p>`;
  },
  thunderstorm: (ctx)=>{
    if(ctx.stormPct==null) return `<p>The sounding doesn't reach 500 hPa, so the K-Index couldn't be computed for this profile.</p>`;
    return `<p>This profile's K-Index is <b>${Math.round(ctx.k)}</b>, mapping to an estimated
      <b>${ctx.stormPct}%</b> thunderstorm probability by George's original table — combined here with a
      CAPE of ${Math.round(ctx.t.cape)} J/kg for the traffic-light read above.</p>`;
  },
  cloudCover: (ctx)=>{
    const octas = cloudPctToOctas(ctx.cloudPct);
    return `<p>The estimated cloud cover for this profile is <b>${ctx.cloudPct}%</b>, corresponding to
      <b>${octas}/8 octas (${octasToMetar(octas)})</b>. Remember this is derived from the humidity
      profile alone, not an actual cloud observation — treat it as a rough cross-check against the
      continuous humidity shading on the main diagram.</p>`;
  },
  shear: (ctx)=>{
    if(ctx.shearKt==null) return `<p>Not enough wind data was available in this profile to compute 0–6 km bulk shear.</p>`;
    const s = ctx.shearKt;
    const cat = s<20?'weak':s<35?'moderate':'strong';
    return `<p>0–6 km bulk shear for this profile is <b>${Math.round(ktToDisplayUnit(s))} ${speedUnitLabel()}</b>, in the <b>${cat}</b>
      range. ${
      s<20 ? 'Combined with the CAPE value of '+Math.round(ctx.t.cape)+' J/kg, any convection this profile supports would likely stay disorganized and short-lived.' :
      s<35 ? 'This level of shear can support organized multicell clusters if enough instability is also present.' :
      'This level of shear, if paired with sufficient CAPE ('+Math.round(ctx.t.cape)+' J/kg here), can support supercell organization.'
      }</p>`;
  },
  inversions: (ctx, rows)=>{
    const layers = detectInversions(rows);
    if(layers.length===0) return `<p>No inversion layers were detected in this profile — temperature
      decreased with height throughout (the normal tropospheric pattern).</p>`;
    const alts = layers.map(l=>formatAltitude(altitudeAtPressure(rows,(l.p0+l.p1)/2), ctx.groundAltM));
    return `<p>This profile measured <b>${layers.length}</b> inversion layer${layers.length>1?'s':''},
      centered near ${alts.join(', ')}. Each one marks a level where vertical mixing is locally
      suppressed — worth cross-checking against the freezing level and cloud layers on the main
      diagram, since inversions often coincide with cloud tops or bases.</p>`;
  },
  isothermal: (ctx, rows)=>{
    const layers = detectIsothermalLayers(rows);
    if(layers.length===0) return `<p>No isothermal layers were detected in this profile.</p>`;
    const alts = layers.map(l=>formatAltitude(altitudeAtPressure(rows,(l.p0+l.p1)/2), ctx.groundAltM));
    return `<p>This profile measured <b>${layers.length}</b> isothermal layer${layers.length>1?'s':''},
      centered near ${alts.join(', ')} — each a level of reduced (though not reversed) vertical
      mixing.</p>`;
  },
  analyticalComments: (ctx)=>{
    return `<p>See the color-coded lines in the Analytical Comments panel itself for this profile's
      specific rain-risk and thunderstorm-risk read, generated from the values discussed above.</p>`;
  },
};

function altitudeAtPressureSafe(ctx, p){ return altitudeAtPressure(LAST_ANALYTICS_ROWS||[], p); }

// ---------- Model-data notes shown in every info modal ----------
const FIELD_MODEL_NOTES_GENERIC = 'This value is computed from a numerical weather model profile (Open-Meteo), not from a radiosonde: the model provides 10&ndash;60 pressure levels instead of thousands of samples, so thin layers are smoothed out and the surface values refer to the model grid cell, whose elevation can differ from the real terrain. Treat the numbers as forecast guidance.';
const FIELD_MODEL_NOTES = {
  lcl: 'The parcel starts from the model 2&nbsp;m temperature and dew point at the grid-cell elevation. Over complex terrain the real surface can be several hundred metres higher or lower, which shifts the LCL accordingly.',
  lfc: 'With only a handful of levels in the lowest 3&nbsp;km, the exact height where the parcel becomes buoyant is interpolated between model levels and can move by a few hundred metres from run to run.',
  cape: 'Model soundings tend to give smaller CAPE than observed soundings because sharp boundary-layer structure is smoothed. Compare with the model\'s own CAPE shown in the time readout below the chart when available.',
  cin: 'Capping inversions thinner than the model level spacing are often missed, so CIN from a model profile can be too small. A strong cap in the model is a robust signal; a weak one is not.',
  li: 'Uses the interpolated 500&nbsp;hPa temperature. All models in this app carry a 500&nbsp;hPa level, so the index is always available when the profile reaches that height.',
  dcape: 'DCAPE needs the driest (lowest Theta-E) air in the lowest 400&nbsp;hPa; with coarse levels the minimum is usually found at a model level rather than exactly where it would be in reality.',
  pw: 'Integrated over the model levels. Precipitable water is one of the most robust quantities in model profiles because it depends on the column as a whole, not on fine structure.',
  freezeLevel: 'Interpolated between model levels. Most models also provide their own freezing-level height; both are shown in the time readout when available so they can be compared.',
  tropopause: 'The WMO criterion needs levels well above the tropopause. Global models (GFS, ICON global, UKMO, ECMWF) reach 30&ndash;10&nbsp;hPa; short-range models such as ICON-D2 stop lower and then report "not reached".',
  thunderstorm: 'The K-index uses the 850, 700 and 500&nbsp;hPa levels, which every model carries. The estimate reflects the model\'s forecast moisture and lapse rates for the selected hour, not an observed state.',
  cloudCover: 'Estimated from the relative humidity at each model level with random overlap. Compare with the model\'s own total cloud cover in the time readout &mdash; large differences usually mean thin or sub-grid cloud.',
  shear: 'Bulk shear from the model winds at the surface and at the level nearest 6&nbsp;km AGL. The 80/120/180&nbsp;m winds (when the model provides them) refine the lowest part of the wind profile.',
  inversions: 'Detected from the temperature gradient between adjacent model levels (&gt; +0.2&nbsp;K/km). Inversions thinner than the level spacing (typically 300&ndash;800&nbsp;m in the lower troposphere) cannot be resolved.',
  isothermal: 'Layers with |gradient| &le; 1.5&nbsp;K/km between adjacent model levels. Because each layer spans whole model levels, the reported thickness is coarse.',
  analyticalComments: 'The traffic-light assessment applies the same thresholds as for a radiosonde, but to a forecast profile. Check several models and several hours before drawing conclusions; agreement between models is the best indicator of confidence.',
};
