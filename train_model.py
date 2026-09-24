import os
import json
import pickle
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

DATASET_DIR = 'dataset'
MODELS_DIR = 'models'

def train_and_export():
    os.makedirs(DATASET_DIR, exist_ok=True)
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    cement_csv = os.path.join(DATASET_DIR, 'cement_carbon_emissions_dataset.csv')
    if not os.path.exists(cement_csv):
        # check if it's in root
        if os.path.exists('cement_carbon_emissions_dataset.csv'):
            cement_csv = 'cement_carbon_emissions_dataset.csv'
        else:
            raise FileNotFoundError("cement_carbon_emissions_dataset.csv not found.")
            
    df_cement = pd.read_csv(cement_csv)
    df_cement['Date'] = pd.to_datetime(df_cement['Date'])
    df_cement['Month'] = df_cement['Date'].dt.strftime('%Y-%m')
    df_cement['Specific_Coal_Kg_Per_Ton'] = (df_cement['Coal_Consumed_Tons'] * 1000) / df_cement['Total_Cement_Produced_Tons']
    df_cement['Clinker_Coal_Interaction'] = df_cement['Clinker_Factor'] * df_cement['Coal_Consumed_Tons']
    df_cement['Effective_Alt_Fuel'] = df_cement['Alternative_Fuel_Substitution_Pct'] / 100.0

    cement_features = [
        'Clinker_Factor',
        'Coal_Consumed_Tons',
        'Alternative_Fuel_Substitution_Pct',
        'Total_Cement_Produced_Tons',
        'Specific_Coal_Kg_Per_Ton'
    ]

    target_intensity = 'Scope1_CO2_Intensity_Tons_Per_Ton'
    target_total = 'Total_Carbon_Emissions_Tons_CO2'

    X_c = df_cement[cement_features]
    y_c_int = df_cement[target_intensity]
    y_c_tot = df_cement[target_total]

    X_c_tr, X_c_te, y_c_tr_int, y_c_te_int = train_test_split(X_c, y_c_int, test_size=0.2, random_state=42)
    _, _, y_c_tr_tot, y_c_te_tot = train_test_split(X_c, y_c_tot, test_size=0.2, random_state=42)

    # 1. Intensity Model
    lr_c_int = LinearRegression().fit(X_c_tr, y_c_tr_int)
    rf_c_int = RandomForestRegressor(n_estimators=100, max_depth=4, random_state=42).fit(X_c_tr, y_c_tr_int)
    results_intensity = {
        'Linear Regression': {
            'R2_Test': float(r2_score(y_c_te_int, lr_c_int.predict(X_c_te))),
            'RMSE': float(np.sqrt(mean_squared_error(y_c_te_int, lr_c_int.predict(X_c_te)))),
            'MAE': float(mean_absolute_error(y_c_te_int, lr_c_int.predict(X_c_te)))
        },
        'Random Forest': {
            'R2_Test': float(r2_score(y_c_te_int, rf_c_int.predict(X_c_te))),
            'RMSE': float(np.sqrt(mean_squared_error(y_c_te_int, rf_c_int.predict(X_c_te)))),
            'MAE': float(mean_absolute_error(y_c_te_int, rf_c_int.predict(X_c_te)))
        }
    }

    # 2. Cement Total Emissions Alone Model
    cement_total_models = {
        'Linear Regression': LinearRegression(),
        'Ridge Regression': Ridge(alpha=1.0),
        'Random Forest': RandomForestRegressor(n_estimators=100, max_depth=4, random_state=42),
        'Gradient Boosting': GradientBoostingRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42)
    }

    results_cement_total = {}
    for name, m in cement_total_models.items():
        m.fit(X_c_tr, y_c_tr_tot)
        preds = m.predict(X_c_te)
        results_cement_total[name] = {
            'R2_Test': float(r2_score(y_c_te_tot, preds)),
            'RMSE': float(np.sqrt(mean_squared_error(y_c_te_tot, preds))),
            'MAE': float(mean_absolute_error(y_c_te_tot, preds))
        }

    # Final fit on all data for deployment
    best_cement_model = LinearRegression().fit(X_c, y_c_tot)
    best_cement_rf = RandomForestRegressor(n_estimators=100, max_depth=4, random_state=42).fit(X_c, y_c_tot)
    best_cement_int = LinearRegression().fit(X_c, y_c_int)

    # Save Cement Model PKL
    cement_pkl_path = os.path.join(MODELS_DIR, 'cement_carbon_model.pkl')
    with open(cement_pkl_path, 'wb') as f:
        pickle.dump({
            'model': best_cement_model,
            'features': cement_features,
            'target': target_total,
            'intercept': float(best_cement_model.intercept_),
            'coefficients': dict(zip(cement_features, best_cement_model.coef_)),
            'rf_importances': dict(zip(cement_features, best_cement_rf.feature_importances_))
        }, f)
    print(f"Saved cement model to {cement_pkl_path}")

    # Electricity Data Generation & Training
    elec_csv = os.path.join(DATASET_DIR, 'electricity_carbon_emissions_dataset.csv')
    if not os.path.exists(elec_csv):
        if os.path.exists('electricity_carbon_emissions_dataset.csv'):
            elec_csv = 'electricity_carbon_emissions_dataset.csv'

    if os.path.exists(elec_csv):
        df_elec = pd.read_csv(elec_csv)
    else:
        np.random.seed(42)
        recs = []
        for idx, row in df_cement.iterrows():
            prod_tons = row['Total_Cement_Produced_Tons']
            kwh_per_ton = np.random.normal(108, 6.5)
            mwh = (prod_tons * kwh_per_ton) / 1000.0
            renewable_pct = float(np.clip(np.random.normal(16.5, 5.0), 4.0, 35.0))
            grid_factor = float(np.random.normal(0.715, 0.025))
            peak_ratio = float(np.clip(np.random.normal(0.42, 0.06), 0.25, 0.65))
            net_grid_mwh = mwh * (1.0 - (renewable_pct / 100.0))
            emissions_tco2 = net_grid_mwh * grid_factor
            recs.append({
                'Date': str(row['Date'].strftime('%Y-%m-%d')),
                'Month': str(row['Month']),
                'Batch_ID': str(row['Batch_ID']),
                'Electricity_MWh': round(float(mwh), 2),
                'Specific_Power_kWh_Ton': round(float(kwh_per_ton), 2),
                'Renewable_Share_Pct': round(float(renewable_pct), 1),
                'Grid_Emission_Factor': round(float(grid_factor), 3),
                'Peak_Hour_Ratio': round(float(peak_ratio), 2),
                'Total_Cement_Produced_Tons': prod_tons,
                'Electricity_Carbon_Emissions_Tons_CO2': round(float(emissions_tco2), 2)
            })
        df_elec = pd.DataFrame(recs)
        df_elec.to_csv(os.path.join(DATASET_DIR, 'electricity_carbon_emissions_dataset.csv'), index=False)

    elec_features = [
        'Electricity_MWh',
        'Renewable_Share_Pct',
        'Grid_Emission_Factor',
        'Total_Cement_Produced_Tons',
        'Specific_Power_kWh_Ton'
    ]
    target_elec = 'Electricity_Carbon_Emissions_Tons_CO2'

    X_e = df_elec[elec_features]
    y_e = df_elec[target_elec]

    X_e_tr, X_e_te, y_e_tr, y_e_te = train_test_split(X_e, y_e, test_size=0.2, random_state=42)

    elec_models = {
        'Linear Regression': LinearRegression(),
        'Ridge Regression': Ridge(alpha=1.0),
        'Random Forest': RandomForestRegressor(n_estimators=100, max_depth=4, random_state=42),
        'Gradient Boosting': GradientBoostingRegressor(n_estimators=100, max_depth=3, learning_rate=0.05, random_state=42)
    }

    results_elec = {}
    for name, m in elec_models.items():
        m.fit(X_e_tr, y_e_tr)
        preds = m.predict(X_e_te)
        results_elec[name] = {
            'R2_Test': float(r2_score(y_e_te, preds)),
            'RMSE': float(np.sqrt(mean_squared_error(y_e_te, preds))),
            'MAE': float(mean_absolute_error(y_e_te, preds))
        }

    best_elec_model = LinearRegression().fit(X_e, y_e)
    best_elec_rf = RandomForestRegressor(n_estimators=100, max_depth=4, random_state=42).fit(X_e, y_e)

    # Save Electricity Model PKL
    elec_pkl_path = os.path.join(MODELS_DIR, 'electricity_carbon_model.pkl')
    with open(elec_pkl_path, 'wb') as f:
        pickle.dump({
            'model': best_elec_model,
            'features': elec_features,
            'target': target_elec,
            'intercept': float(best_elec_model.intercept_),
            'coefficients': dict(zip(elec_features, best_elec_model.coef_)),
            'rf_importances': dict(zip(elec_features, best_elec_rf.feature_importances_))
        }, f)
    print(f"Saved electricity model to {elec_pkl_path}")

    # Build predictions
    df_cement['Predicted_Intensity'] = best_cement_int.predict(X_c)
    df_cement['Predicted_Total_CO2'] = best_cement_model.predict(X_c)
    df_elec['Predicted_Elec_CO2'] = best_elec_model.predict(X_e)

    cement_batches = []
    for idx, row in df_cement.iterrows():
        cement_batches.append({
            'Date': str(row['Date'].strftime('%Y-%m-%d')),
            'Month': str(row['Month']),
            'Batch_ID': str(row['Batch_ID']),
            'Clinker_Factor': float(row['Clinker_Factor']),
            'Coal_Consumed_Tons': float(row['Coal_Consumed_Tons']),
            'Alternative_Fuel_Substitution_Pct': float(row['Alternative_Fuel_Substitution_Pct']),
            'Total_Cement_Produced_Tons': float(row['Total_Cement_Produced_Tons']),
            'Specific_Coal_Kg_Per_Ton': float(row['Specific_Coal_Kg_Per_Ton']),
            'Actual_Intensity': float(row[target_intensity]),
            'Predicted_Intensity': float(row['Predicted_Intensity']),
            'Actual_Total_CO2': float(row[target_total]),
            'Predicted_Total_CO2': float(row['Predicted_Total_CO2']),
            'Residual_Total': float(row[target_total] - row['Predicted_Total_CO2'])
        })

    elec_records = []
    for idx, row in df_elec.iterrows():
        elec_records.append({
            'Date': str(row['Date']),
            'Month': str(row['Month']),
            'Batch_ID': str(row['Batch_ID']),
            'Electricity_MWh': float(row['Electricity_MWh']),
            'Specific_Power_kWh_Ton': float(row['Specific_Power_kWh_Ton']),
            'Renewable_Share_Pct': float(row['Renewable_Share_Pct']),
            'Grid_Emission_Factor': float(row['Grid_Emission_Factor']),
            'Total_Cement_Produced_Tons': float(row['Total_Cement_Produced_Tons']),
            'Actual_Elec_CO2': float(row['Electricity_Carbon_Emissions_Tons_CO2']),
            'Predicted_Elec_CO2': round(float(row['Predicted_Elec_CO2']), 2),
            'Residual': round(float(row['Electricity_Carbon_Emissions_Tons_CO2'] - row['Predicted_Elec_CO2']), 2)
        })

    # Daily unified timeline
    daily_timeline = []
    c_map = {b['Date']: b for b in cement_batches}
    e_map = {b['Date']: b for b in elec_records}

    for d in sorted(list(c_map.keys())):
        cb = c_map[d]
        eb = e_map.get(d, {})
        c_act = cb['Actual_Total_CO2']
        c_pred = cb['Predicted_Total_CO2']
        e_act = eb.get('Actual_Elec_CO2', 0.0)
        e_pred = eb.get('Predicted_Elec_CO2', 0.0)
        daily_timeline.append({
            'Date': d,
            'Month': cb['Month'],
            'Batch_ID': cb['Batch_ID'],
            'Cement_Output_Tons': cb['Total_Cement_Produced_Tons'],
            'Cement_CO2_Actual': round(c_act, 2),
            'Cement_CO2_Pred': round(c_pred, 2),
            'Electricity_MWh': eb.get('Electricity_MWh', 0.0),
            'Elec_CO2_Actual': round(e_act, 2),
            'Elec_CO2_Pred': round(e_pred, 2),
            'Combined_Total_CO2_Actual': round(c_act + e_act, 2),
            'Combined_Total_CO2_Pred': round(c_pred + e_pred, 2)
        })

    # Monthly summary
    monthly_data = {}
    for item in daily_timeline:
        m = item['Month']
        if m not in monthly_data:
            monthly_data[m] = {
                'Month': m,
                'Days_Count': 0,
                'Cement_Produced_Tons': 0.0,
                'Cement_CO2_Tons': 0.0,
                'Electricity_MWh': 0.0,
                'Elec_CO2_Tons': 0.0,
                'Combined_CO2_Tons': 0.0
            }
        monthly_data[m]['Days_Count'] += 1
        monthly_data[m]['Cement_Produced_Tons'] += item['Cement_Output_Tons']
        monthly_data[m]['Cement_CO2_Tons'] += item['Cement_CO2_Actual']
        monthly_data[m]['Electricity_MWh'] += item['Electricity_MWh']
        monthly_data[m]['Elec_CO2_Tons'] += item['Elec_CO2_Actual']
        monthly_data[m]['Combined_CO2_Tons'] += item['Combined_Total_CO2_Actual']

    monthly_summary = []
    for m in sorted(monthly_data.keys()):
        row = monthly_data[m]
        monthly_summary.append({
            'Month': m,
            'Days_Count': row['Days_Count'],
            'Cement_Produced_Tons': round(row['Cement_Produced_Tons'], 1),
            'Cement_CO2_Tons': round(row['Cement_CO2_Tons'], 1),
            'Electricity_MWh': round(row['Electricity_MWh'], 1),
            'Elec_CO2_Tons': round(row['Elec_CO2_Tons'], 1),
            'Combined_CO2_Tons': round(row['Combined_CO2_Tons'], 1),
            'Scope1_Share_Pct': round((row['Cement_CO2_Tons'] / row['Combined_CO2_Tons']) * 100, 1),
            'Scope2_Share_Pct': round((row['Elec_CO2_Tons'] / row['Combined_CO2_Tons']) * 100, 1)
        })

    metadata = {
        'cement': {
            'results_intensity': results_intensity,
            'results_total': results_cement_total,
            'linear_coefficients_total': dict(zip(cement_features, best_cement_model.coef_)),
            'linear_intercept_total': float(best_cement_model.intercept_),
            'rf_importances_total': dict(zip(cement_features, best_cement_rf.feature_importances_)),
            'batches': cement_batches
        },
        'electricity': {
            'results_elec': results_elec,
            'linear_coefficients_elec': dict(zip(elec_features, best_elec_model.coef_)),
            'linear_intercept_elec': float(best_elec_model.intercept_),
            'rf_importances_elec': dict(zip(elec_features, best_elec_rf.feature_importances_)),
            'records': elec_records
        },
        'daily_timeline': daily_timeline,
        'monthly_summary': monthly_summary
    }

    # Save metadata json into models directory and static
    for target in [os.path.join(MODELS_DIR, 'model_metadata.json'), 'model_results.json', os.path.join('static', 'model_results.json')]:
        with open(target, 'w') as f:
            json.dump(metadata, f, indent=2)

    print("Model training & export complete! PKL models and metadata generated.")

if __name__ == '__main__':
    train_and_export()
