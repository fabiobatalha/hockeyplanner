from flask_babel import gettext


def sample_drill() -> dict:
    return {
        "id": None,
        "title": gettext("Breakout passing"),
        "description": gettext("Skate with the puck, pass to your teammate, then head toward the net."),
        "layout": "full",
        "items": [
            {"type": "carry", "x": 160, "y": 325, "bendX": 275, "bendY": 330, "endX": 370, "endY": 230},
            {"type": "pass", "x": 380, "y": 225, "endX": 620, "endY": 115},
            {"type": "forward", "x": 650, "y": 116, "bendX": 760, "bendY": 125, "endX": 825, "endY": 235},
            {"type": "player", "x": 150, "y": 330, "team": "A"},
            {"type": "player", "x": 640, "y": 108, "team": "A"},
            {"type": "cone", "x": 318, "y": 302},
            {"type": "cone", "x": 780, "y": 185},
            {"type": "goal", "x": 917, "y": 230, "rotation": 90},
        ],
    }
