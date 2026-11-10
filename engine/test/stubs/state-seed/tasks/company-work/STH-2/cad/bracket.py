import cadquery as cq

result = (
    cq.Workplane("XY").box(60, 40, 5)
    .faces(">Z").workplane()
    .pushPoints([(-20, 0), (20, 0)]).hole(6)
)
