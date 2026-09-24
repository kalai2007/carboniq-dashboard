import os
import json
import pickle
import sqlite3
import webbrowser
import threading
import time
import warnings
from datetime import datetime
from flask import Flask, render_template, jsonify, request, session
import pandas as pd
import numpy as np

warnings.filterwarnings('ignore', category=UserWarning)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, 'models')
DATASET_DIR = os.path.join(BASE_DIR, 'dataset')
DB_PATH = os.environ.get('DATABASE_PATH', os.path.join(BASE_DIR, 'carboniq.db'))

app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.environ.get('SECRET_KEY', 'carboniq_enterprise_super_secret_key_2026')

# -------------------------------------------------------------
# DATABASE INITIALIZATION (SQLite)
# -------------------------------------------------------------
def init_db():
    db_directory = os.path.dirname(DB_PATH)
    if db_directory:
        os.makedirs(db_directory, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'Plant Environmental Engineer',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Predictions / Input & Output History Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS carbon_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            source_type TEXT,
            input_summary TEXT,
            predicted_co2 REAL,
            intensity_or_kwh REAL,
            abatement_saved REAL,
            reduction_suggestion TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Pre-seed demo users if not present
    cursor.execute("SELECT id FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'Sustainability Director')")
        cursor.execute("INSERT INTO users (username, password, role) VALUES ('engineer', 'carbon2026', 'Plant Operations Engineer')")
    
    conn.commit()
    conn.close()
    print("SQLite database carboniq.db initialized.")

init_db()

# -------------------------------------------------------------
# LOAD TRAINED PKL MODELS & METADATA
# -------------------------------------------------------------
cement_pkl_path = os.path.join(MODELS_DIR, 'cement_carbon_model.pkl')
elec_pkl_path = os.path.join(MODELS_DIR, 'electricity_carbon_model.pkl')
metadata_path = os.path.join(MODELS_DIR, 'model_metadata.json')

cement_artifact = None
elec_artifact = None
model_metadata = {}

if os.path.exists(cement_pkl_path):
    with open(cement_pkl_path, 'rb') as f:
        cement_artifact = pickle.load(f)

if os.path.exists(elec_pkl_path):
    with open(elec_pkl_path, 'rb') as f:
        elec_artifact = pickle.load(f)

if os.path.exists(metadata_path):
    with open(metadata_path, 'r') as f:
        model_metadata = json.load(f)

# -------------------------------------------------------------
# FLASK AUTHENTICATION ROUTES
# -------------------------------------------------------------
@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    if 'username' in session:
        return jsonify({
            'logged_in': True,
            'username': session.get('username'),
            'role': session.get('role', 'Sustainability Director')
        })
    return jsonify({'logged_in': False})

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json(force=True)
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required.'}), 400
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, password, role FROM users WHERE username = ?", (username,))
    user = cursor.fetchone()
    conn.close()
    
    if user and user[2] == password:
        session['user_id'] = user[0]
        session['username'] = user[1]
        session['role'] = user[3]
        return jsonify({'success': True, 'username': user[1], 'role': user[3]})
    else:
        return jsonify({'success': False, 'message': 'Invalid username or password.'}), 401

@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json(force=True)
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    role = data.get('role', 'Plant Environmental Engineer').strip()
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required.'}), 400
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", (username, password, role))
        conn.commit()
        session['username'] = username
        session['role'] = role
        conn.close()
        return jsonify({'success': True, 'username': username, 'role': role})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'success': False, 'message': 'Username already exists. Please pick another.'}), 409

@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})

# -------------------------------------------------------------
# DASHBOARD PAGE & DATA ENDPOINTS
# -------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'carboniq'})

@app.route('/api/data', methods=['GET'])
def get_data():
    return jsonify(model_metadata)

@app.route('/api/history', methods=['GET'])
def get_history():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, username, source_type, input_summary, predicted_co2, intensity_or_kwh, abatement_saved, reduction_suggestion, created_at 
        FROM carbon_records 
        ORDER BY id DESC LIMIT 50
    ''')
    rows = cursor.fetchall()
    conn.close()
    
    history = []
    for r in rows:
        history.append({
            'id': r[0],
            'username': r[1],
            'source_type': r[2],
            'input_summary': r[3],
            'predicted_co2': r[4],
            'intensity_or_kwh': r[5],
            'abatement_saved': r[6],
            'reduction_suggestion': r[7],
            'created_at': r[8]
        })
    return jsonify(history)

# -------------------------------------------------------------
# UNIFIED DUAL PREDICTION & DB STORAGE ROUTE
# -------------------------------------------------------------
@app.route('/api/predict/unified', methods=['POST'])
def predict_unified():
    """Predicts Cement and/or Electricity emissions and logs inputs/outputs to SQLite DB."""
    try:
        data = request.get_json(force=True)
        user = session.get('username', 'Guest/Operator')

        # Cement Process inputs
        clinker = float(data.get('clinker_factor', 0.75))
        coal = float(data.get('coal_consumed_tons', 12.5))
        alt_fuel = float(data.get('alternative_fuel_pct', 15.0))
        output = float(data.get('cement_produced_tons', 1000.0))
        specific_coal = (coal * 1000.0) / output

        # Electricity inputs
        mwh = float(data.get('electricity_mwh', 115.0))
        renew = float(data.get('renewable_share_pct', 16.5))
        grid_factor = float(data.get('grid_emission_factor', 0.715))
        kwh_per_ton = (mwh * 1000.0) / output

        # 1. Cement Prediction
        if cement_artifact and 'model' in cement_artifact:
            import numpy as np
            features_c = np.array([[clinker, coal, alt_fuel, output, specific_coal]])
            pred_cement_co2 = float(cement_artifact['model'].predict(features_c)[0])
        else:
            pred_cement_co2 = -771.49 + (538.49 * clinker) + (23.56 * coal) - (0.424 * alt_fuel) + (0.736 * output) + (2.33 * specific_coal)

        cement_intensity = pred_cement_co2 / output
        cement_baseline = 731.9
        cement_saved = round(max(0.0, cement_baseline - pred_cement_co2), 2)

        # 2. Electricity Prediction
        if elec_artifact and 'model' in elec_artifact:
            import numpy as np
            features_e = np.array([[mwh, renew, grid_factor, output, kwh_per_ton]])
            pred_elec_co2 = float(elec_artifact['model'].predict(features_e)[0])
        else:
            pred_elec_co2 = -67.73 + (0.654 * mwh) - (0.818 * renew) + (97.0 * grid_factor) - (0.006 * output) + (0.007 * kwh_per_ton)

        pred_elec_co2 = max(0.0, pred_elec_co2)
        gross_elec = mwh * grid_factor
        elec_saved = round(max(0.0, gross_elec - pred_elec_co2), 2)

        combined_co2 = round(pred_cement_co2 + pred_elec_co2, 2)
        total_saved = round(cement_saved + elec_saved, 2)

        # 3. Dynamic Actionable Reduction Suggestions
        suggestions = []
        if clinker > 0.72:
            suggestions.append(f"Clinker Factor ({clinker:.3f}) is high. Target 0.68 by blending LC3/slag to reduce ~{((clinker-0.68)*538):.1f} tCO₂.")
        else:
            suggestions.append(f"Optimal clinker factor ({clinker:.3f}) maintained.")

        if alt_fuel < 25.0:
            suggestions.append(f"Increase Alt. Fuel substitution from {alt_fuel:.1f}% to 30%+ (biomass/RDF) to cut coal emissions.")
        else:
            suggestions.append(f"Strong thermal substitution ({alt_fuel:.1f}%) effectively displacing fossil coal.")

        if renew < 30.0:
            suggestions.append(f"Scale renewable solar/PPA share from {renew:.1f}% to 50%+ to cut Scope 2 power carbon.")
        else:
            suggestions.append(f"High clean energy mix ({renew:.1f}%) insulating plant from grid emissions.")

        if kwh_per_ton > 105.0:
            suggestions.append(f"Mill specific power ({kwh_per_ton:.1f} kWh/t) exceeds 100 kWh/t benchmark. Install VFDs on raw ball mills.")

        reduction_text = " | ".join(suggestions)
        input_summary = f"Clinker: {clinker:.3f}, Coal: {coal:.1f}t, AltFuel: {alt_fuel:.1f}%, Power: {mwh:.1f}MWh, Renew: {renew:.1f}%"

        # 4. Save to Local SQLite DB
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO carbon_records 
            (username, source_type, input_summary, predicted_co2, intensity_or_kwh, abatement_saved, reduction_suggestion) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (user, 'Unified Dual Core', input_summary, combined_co2, round(cement_intensity, 4), total_saved, reduction_text))
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'predicted_cement_co2': round(pred_cement_co2, 2),
            'cement_intensity': round(cement_intensity, 4),
            'cement_saved': cement_saved,
            'predicted_elec_co2': round(pred_elec_co2, 2),
            'specific_power_kwh': round(kwh_per_ton, 1),
            'elec_saved': elec_saved,
            'combined_total_co2': combined_co2,
            'total_abatement_saved': total_saved,
            'reduction_suggestions': suggestions,
            'logged_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# -------------------------------------------------------------
# AUTO BROWSER LAUNCH
# -------------------------------------------------------------
def open_browser():
    time.sleep(1.2)
    url = "http://127.0.0.1:5000"
    print(f"Opening browser at {url}...")
    webbrowser.open(url)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    host = os.environ.get('HOST', '127.0.0.1')
    if os.environ.get('OPEN_BROWSER', '1') == '1' and not os.environ.get('RENDER'):
        threading.Thread(target=open_browser, daemon=True).start()
    print(f"CarbonIQ Unified Engine with SQLite running on http://{host}:{port} ...")
    app.run(host=host, port=port, debug=False)
