for now one turn will represent roughly 1 week
one cell will be roughly 1000km x 1000km
so at 100km/h a land vehicle would traverse roughly 2400km a day = 16800km a week ~= 17 cells per turn
infantry would traverse 1/20 of that or roughly 1 cell per turn
- widgets + human-time + factory-time = weapons
- widgets

## food
adequacy = calories_per_week / required_calories_per_week
deficit = max(0, 1 - adequacy)
surplus = max(0, adequacy - 1)

malnutrition_burden =
  clamp(malnutrition_burden + deficit * 7/90 - surplus * 0.14, 0, 1)

mortality_per_week =
  normal_mortality_per_week + 0.19 * malnutrition_burden^4

labor_productivity =
  1 - 0.6 * malnutrition_burden^2

fertility =
  base_fertility * (1 - malnutrition_burden)^2
add a food resource and a farm resource. labor -> food (with farm requirement) recipe. consumers should prioritize food over product. 
separate population into a young, an adult and an old population cohort. they are just new resources ("young", "working_age" and "elderly") owned by consumer agents. a constant fertility generates young proportionally to adult.
there should be a life expectancy constant. store an actuarial life table from the web and calculate the percentage of old people that will die each turn (1 week) assuming every one of them lives exactly up to life expectancy and that "elderly" starts at age 60. adult should be 20 to 60 so there should be a constant death rate, just as for children.
also educational attainment and classes resources
so now you have
-> labor (working age pop requirement)
-> young leisure (young pop requirement)
-> literate labor (literacy requirement)
-> educated labor (higher education requirement)

higher education -> school classes (school requirement)
higher education -> college classes (college requirement)
school classes + young leisure -> young literacy (young pop - young literacy requirement)
school classes + labor -> working age literacy (working age pop - working age literacy)
college classes + labor -> higher education
