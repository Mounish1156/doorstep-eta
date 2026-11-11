import json, os
import joblib
import pandas as pd
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
if not os.path.exists("model.joblib"):
    import train
    train.main()
model = joblib.load("model.joblib")
metrics = json.load(open("metrics.json"))

CHOICES = {
    "weather": ["Clear", "Foggy", "Rainy", "Windy", "Snowy"],
    "traffic": ["Low", "Medium", "High"],
    "time_of_day": ["Morning", "Afternoon", "Evening", "Night"],
    "vehicle": ["Bike", "Scooter", "Car"],
}
BASE = {"Bike": 22, "Scooter": 28, "Car": 30}
TRAFFIC = {"Low": 1.0, "Medium": .8, "High": .6}
WEATHER = {"Clear": 1.0, "Windy": .95, "Foggy": .9, "Rainy": .8, "Snowy": .65}


@app.get("/")
def index():
    return render_template("index.html", choices=CHOICES, metrics=metrics)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict():
    d = request.get_json(silent=True) or {}
    try:
        dist = float(d["distance"]); prep = float(d["prep"]); exp = float(d["experience"])
        for k, opts in CHOICES.items():
            if d.get(k) not in opts:
                raise ValueError(f"Choose a valid {k.replace('_', ' ')}.")
        if not (0.1 <= dist <= 50 and 0 <= prep <= 120 and 0 <= exp <= 40):
            raise ValueError("Distance, prep time or experience is out of range.")
    except (KeyError, TypeError, ValueError) as e:
        return jsonify(error=str(e) if isinstance(e, ValueError) else "Fill in every field."), 400

    row = pd.DataFrame([{
        "Weather": d["weather"], "Traffic_Level": d["traffic"], "Time_of_Day": d["time_of_day"],
        "Vehicle_Type": d["vehicle"], "Distance_km": dist,
        "Preparation_Time_min": prep, "Courier_Experience_yrs": exp,
    }])
    total = max(float(model.predict(row)[0]), prep + 5)
    speed = BASE[d["vehicle"]] * TRAFFIC[d["traffic"]] * WEATHER[d["weather"]]
    ride = min(dist / speed * 60, total - prep - 2)
    handoff = total - prep - ride
    return jsonify(
        minutes=round(total),
        low=max(round(total - metrics["mae"] * 1.5), 1),
        high=round(total + metrics["mae"] * 1.5),
        parts={"prep": round(prep), "handoff": round(handoff), "ride": round(ride)},
    )


if __name__ == "__main__":
    app.run(debug=True)
