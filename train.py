"""Train the delivery-time model.

Uses data/delivery.csv if present (e.g. the Kaggle "Food Delivery Time Prediction"
dataset with the same columns); otherwise generates a realistic synthetic dataset.
"""
import json, os
import numpy as np
import pandas as pd
import joblib
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

CAT = ["Weather", "Traffic_Level", "Time_of_Day", "Vehicle_Type"]
NUM = ["Distance_km", "Preparation_Time_min", "Courier_Experience_yrs"]
TARGET = "Delivery_Time_min"
CSV = os.path.join("data", "delivery.csv")


def make_data(n=6000, seed=42):
    r = np.random.default_rng(seed)
    d = pd.DataFrame({
        "Distance_km": r.uniform(0.5, 20, n).round(2),
        "Weather": r.choice(["Clear", "Foggy", "Rainy", "Windy", "Snowy"], n, p=[.5, .1, .2, .12, .08]),
        "Traffic_Level": r.choice(["Low", "Medium", "High"], n, p=[.3, .4, .3]),
        "Time_of_Day": r.choice(["Morning", "Afternoon", "Evening", "Night"], n, p=[.2, .3, .3, .2]),
        "Vehicle_Type": r.choice(["Bike", "Scooter", "Car"], n, p=[.4, .4, .2]),
        "Preparation_Time_min": r.integers(5, 31, n),
        "Courier_Experience_yrs": r.integers(0, 16, n),
    })
    base = d.Vehicle_Type.map({"Bike": 22, "Scooter": 28, "Car": 30})
    traffic = d.Traffic_Level.map({"Low": 1.0, "Medium": .8, "High": .6})
    weather = d.Weather.map({"Clear": 1.0, "Windy": .95, "Foggy": .9, "Rainy": .8, "Snowy": .65})
    tod = d.Time_of_Day.map({"Morning": 0, "Afternoon": 1, "Evening": 4, "Night": 2})
    speed = base * traffic * weather
    d[TARGET] = (d.Preparation_Time_min + d.Distance_km / speed * 60 + 4 + tod
                 - 0.35 * d.Courier_Experience_yrs + r.normal(0, 3, n)).clip(lower=8).round().astype(int)
    return d


def main():
    df = pd.read_csv(CSV) if os.path.exists(CSV) else make_data()
    df = df.dropna(subset=CAT + NUM + [TARGET])
    X, y = df[CAT + NUM], df[TARGET]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=7)
    pre = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), CAT),
        ("num", StandardScaler(), NUM),
    ])
    candidates = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=200, min_samples_leaf=3, random_state=7, n_jobs=-1),
        "Gradient Boosting": GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.08, random_state=7),
    }
    results, best = {}, None
    for name, est in candidates.items():
        pipe = Pipeline([("pre", pre), ("model", est)]).fit(Xtr, ytr)
        p = pipe.predict(Xte)
        m = {"mae": round(mean_absolute_error(yte, p), 2),
             "rmse": round(float(np.sqrt(mean_squared_error(yte, p))), 2),
             "r2": round(r2_score(yte, p), 3)}
        results[name] = m
        print(f"{name:20s} {m}")
        if best is None or m["rmse"] < best[1]["rmse"]:
            best = (name, m, pipe)
    name, m, pipe = best
    joblib.dump(pipe, "model.joblib")
    json.dump({"best": name, **m, "rows": int(len(df)), "all": results}, open("metrics.json", "w"), indent=2)
    print("Saved model:", name)


if __name__ == "__main__":
    main()
