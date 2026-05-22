from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from flask_cors import CORS
import mysql.connector
import bcrypt
import jwt
import datetime
import random
import os
import urllib.parse
import uuid
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
import google.generativeai as genai

app = Flask(__name__)
CORS(app)

app.config['SECRET_KEY'] = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!'

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "YOUR_ACTUAL_GEMINI_API_KEY_HERE")
genai.configure(api_key=GEMINI_API_KEY)

UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ==========================================
# CẤU HÌNH GỬI EMAIL (SMTP)
# ==========================================
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USERNAME = "your_email@gmail.com" # Thay bằng email Gmail của bạn
SMTP_PASSWORD = "your_app_password"    # Thay bằng Mật khẩu ứng dụng (App Password)

def send_notification_email(to_email, subject, body_html, attachment_name=None, attachment_data=None):
    try:
        if not SMTP_USERNAME or SMTP_USERNAME == "your_email@gmail.com":
            print(f"\n[MÔ PHỎNG EMAIL] Đã gửi tới {to_email} | Tiêu đề: {subject}\n")
            return # Nếu chưa cấu hình, hệ thống sẽ in ra console thay vì báo lỗi
            
        msg = MIMEMultipart()
        msg['From'] = SMTP_USERNAME
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body_html, 'html'))
        
        if attachment_name and attachment_data:
            part = MIMEApplication(attachment_data, Name=attachment_name)
            part['Content-Disposition'] = f'attachment; filename="{attachment_name}"'
            msg.attach(part)
            
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"Đã gửi email thành công tới {to_email}")
    except Exception as e:
        print(f"Lỗi gửi email tới {to_email}: {e}")

def get_db_connection():
    return mysql.connector.connect(
        host="localhost",
        user="root",        
        password="",
        port=3307,        
        database="coursera_advanced_db"
    )

@app.route('/', methods=['GET'])
def home():
    return jsonify({"message": "Backend Coursera Advanced is running successfully!"})

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    fullname = data.get('fullname')
    email = data.get('email')
    password = data.get('password')

    if not fullname or not email or not password:
        return jsonify({"message": "Vui lòng điền đầy đủ thông tin!"}), 400

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
        existing_user = cursor.fetchone()
        if existing_user:
            return jsonify({"message": "Email này đã được đăng ký!"}), 409

        hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        sql = "INSERT INTO users (fullname, email, password_hash) VALUES (%s, %s, %s)"
        val = (fullname, email, hashed_password)
        cursor.execute(sql, val)
        db.commit()

        return jsonify({"message": "Đăng ký tài khoản thành công!"}), 201

    except Exception as e:
        print("Lỗi Database:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"message": "Vui lòng nhập email và mật khẩu!"}), 400

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
        user = cursor.fetchone()

        if not user or not bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8')):
            return jsonify({"message": "Email hoặc mật khẩu không đúng!"}), 401

        token_payload = {
            'user_id': user['id'],
            'email': user['email'],
            'fullname': user['fullname'],
            'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
        }
        token = jwt.encode(token_payload, app.config['SECRET_KEY'], algorithm='HS256')

        return jsonify({
            "message": "Đăng nhập thành công!",
            "token": token,
            "user": {
                "fullname": user['fullname'],
                "email": user['email'],
                "role": user['role']
            }
        }), 200

    except Exception as e:
        print("Lỗi Database:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/user/dashboard', methods=['GET'])
def get_user_dashboard():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Bạn chưa đăng nhập hoặc phiên làm việc hết hạn!"}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)
        
        cursor.execute("SELECT id, fullname, email, role, created_at FROM users WHERE id = %s", (user_id,))
        user_info = cursor.fetchone()
        
        cursor.execute("SELECT id, course_name, price, current_step, created_at FROM orders WHERE user_id = %s ORDER BY id DESC", (user_id,))
        user_orders = cursor.fetchall()
        
        if user_info:
            user_info['created_at'] = user_info['created_at'].strftime('%d/%m/%Y')
        for order in user_orders:
            order['created_at'] = order['created_at'].strftime('%d/%m/%Y %H:%M')

        cursor.close()
        db.close()
        
        return jsonify({
            "user": user_info,
            "orders": user_orders
        }), 200
        
    except jwt.ExpiredSignatureError:
        return jsonify({"message": "Phiên đăng nhập đã hết hạn!"}), 401
    except jwt.InvalidTokenError:
        return jsonify({"message": "Chữ ký xác thực token không hợp lệ!"}), 401
    except Exception as e:
        print("Lỗi Dashboard API:", e)
        return jsonify({"message": "Lỗi lấy dữ liệu người dùng"}), 500

@app.route('/api/user/change-password', methods=['POST'])
def change_password():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối!"}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        data = request.get_json()
        old_password = data.get('oldPassword')
        new_password = data.get('newPassword')
        
        if not old_password or not new_password:
            return jsonify({"message": "Vui lòng nhập đầy đủ thông tin!"}), 400
            
        db = get_db_connection()
        cursor = db.cursor(dictionary=True)
        
        cursor.execute("SELECT password_hash FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        
        if not user or not bcrypt.checkpw(old_password.encode('utf-8'), user['password_hash'].encode('utf-8')):
            return jsonify({"message": "Mật khẩu cũ không chính xác!"}), 400
            
        new_hashed = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cursor.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hashed, user_id))
        db.commit()
        
        cursor.close()
        db.close()
        return jsonify({"message": "Thay đổi mật khẩu thành công!"}), 200
        
    except Exception as e:
        print("Lỗi đổi mật khẩu:", e)
        return jsonify({"message": "Lỗi hệ thống, vui lòng thử lại sau!"}), 500

@app.route('/api/courses', methods=['GET'])
def get_courses():
    auth_header = request.headers.get('Authorization')
    user_id = None
    if auth_header and 'Bearer ' in auth_header:
        token = auth_header.split(' ')[1]
        try:
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            pass 

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)
    
    try:
        user_orders = {}
        if user_id:
            cursor.execute("SELECT course_name, current_step FROM orders WHERE user_id = %s", (user_id,))
            for ord_row in cursor.fetchall():
                user_orders[ord_row['course_name']] = ord_row['current_step']

        cursor.execute("SELECT id, title, original_price, price, badge, color, icon FROM courses")
        courses = cursor.fetchall()
        
        for course_item in courses:
            c_id = course_item['id']
            if c_id in user_orders:
                step = user_orders[c_id]
                if step == 3:
                    course_item['lock_status'] = 'UNLOCKED'
                else:
                    course_item['lock_status'] = 'LOCKED'
            else:
                if c_id in ('course_1', 'course_2'):
                    course_item['lock_status'] = 'UNLOCKED'
                else:
                    course_item['lock_status'] = 'LOCKED'

            cursor.execute("SELECT id, week_number, title FROM course_weeks WHERE course_id = %s ORDER BY week_number", (c_id,))
            weeks = cursor.fetchall()
            
            for week in weeks:
                cursor.execute("SELECT id, type, title, duration, video_url as videoSrc, description, quiz_question, quiz_option_a, quiz_option_b, quiz_correct_answer FROM lessons WHERE week_id = %s", (week['id'],))
                lessons = cursor.fetchall()
                
                for lesson in lessons:
                    lesson['completed'] = False
                    if user_id:
                        cursor.execute("SELECT 1 FROM user_progress WHERE user_id = %s AND lesson_id = %s", (user_id, lesson['id']))
                        if cursor.fetchone():
                            lesson['completed'] = True
                    
                    if lesson.get('quiz_question'):
                        lesson['quiz'] = {
                            "question": lesson['quiz_question'],
                            "correct": lesson['quiz_correct_answer'],
                            "options": [
                                {"v": "a", "t": lesson.get('quiz_option_a', 'Đáp án A')}, 
                                {"v": "b", "t": lesson.get('quiz_option_b', 'Đáp án B')}
                            ] 
                        }
                    else:
                        lesson['quiz'] = None

                    lesson.pop('quiz_question', None)
                    lesson.pop('quiz_option_a', None)
                    lesson.pop('quiz_option_b', None)
                    lesson.pop('quiz_correct_answer', None)

                week['items'] = lessons
            course_item['weeks'] = weeks

        return jsonify({"courses": courses}), 200

    except Exception as e:
        print("Lỗi API Courses:", e)
        return jsonify({"message": "Lỗi lấy dữ liệu khóa học"}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/user/progress', methods=['POST'])
def save_progress():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối!"}), 401
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        data = request.get_json()
        lesson_id = data.get('lesson_id')
        
        if not lesson_id:
            return jsonify({"message": "Thiếu mã bài học!"}), 400
        
        db = get_db_connection()
        cursor = db.cursor()
        
        cursor.execute("INSERT IGNORE INTO user_progress (user_id, lesson_id) VALUES (%s, %s)", (user_id, lesson_id))
        db.commit()
        
        return jsonify({"message": "Đã cập nhật tiến độ học tập."}), 200
    except Exception as e:
        print("Lỗi lưu tiến trình:", e)
        return jsonify({"message": "Lỗi hệ thống"}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"message": "Vui lòng cung cấp email!"}), 400

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if not cursor.fetchone():
            return jsonify({"message": "Email không tồn tại trong hệ thống."}), 404

        otp_code = str(random.randint(100000, 999999))
        expires_at = datetime.datetime.now() + datetime.timedelta(minutes=15)

        cursor.execute("INSERT INTO otp_codes (email, otp, expires_at) VALUES (%s, %s, %s)", 
                       (email, otp_code, expires_at))
        db.commit()

        print(f"\n[HỆ THỐNG EMAIL MÔ PHỎNG] Mã OTP của tài khoản {email} là: {otp_code}\n")
        return jsonify({"message": "Mã OTP đã được gửi tới email của bạn."}), 200

    except Exception as e:
        print("Lỗi forgot-password:", e)
        return jsonify({"message": "Lỗi máy chủ."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/auth/verify-otp', methods=['POST'])
def verify_otp():
    data = request.get_json()
    email = data.get('email')
    otp = data.get('otp')

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("SELECT * FROM otp_codes WHERE email = %s ORDER BY id DESC LIMIT 1", (email,))
        record = cursor.fetchone()

        if not record:
            return jsonify({"message": "Không tìm thấy yêu cầu cấp lại mật khẩu cho email này."}), 400

        if record['otp'] != otp:
            return jsonify({"message": "Mã xác nhận không đúng."}), 400
            
        if record['expires_at'] < datetime.datetime.now():
            return jsonify({"message": "Mã xác nhận đã hết hạn."}), 400

        reset_token = jwt.encode(
            {'email': email, 'action': 'reset_password', 'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=15)}, 
            app.config['SECRET_KEY'], 
            algorithm='HS256'
        )

        return jsonify({"message": "Xác thực OTP thành công.", "token": reset_token}), 200

    except Exception as e:
        print("Lỗi verify-otp:", e)
        return jsonify({"message": "Lỗi máy chủ."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    email = data.get('email')
    new_password = data.get('newPassword')
    token = data.get('token')

    if not token or not new_password:
        return jsonify({"message": "Dữ liệu không hợp lệ."}), 400

    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        if payload.get('action') != 'reset_password' or payload.get('email') != email:
            return jsonify({"message": "Phiên làm việc không hợp lệ."}), 403

        db = get_db_connection()
        cursor = db.cursor()

        new_hashed = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cursor.execute("UPDATE users SET password_hash = %s WHERE email = %s", (new_hashed, email))
        cursor.execute("DELETE FROM otp_codes WHERE email = %s", (email,))
        db.commit()

        return jsonify({"message": "Đổi mật khẩu thành công!"}), 200

    except jwt.ExpiredSignatureError:
        return jsonify({"message": "Thời gian đổi mật khẩu đã hết hạn."}), 400
    except Exception as e:
        print("Lỗi reset-password:", e)
        return jsonify({"message": "Lỗi hệ thống."}), 500
    finally:
        try:
            cursor.close()
            db.close()
        except:
            pass

@app.route('/api/chatbot', methods=['POST'])
def cyber_chatbot():
    data = request.json or {}
    user_message = data.get('message', '').strip()
    course_id = data.get('course_id', 'Tổng quát')
    
    if not user_message:
        return jsonify({"message": "Tin nhắn của học viên đang để trống!"}), 400
        
    system_instruction = (
        "Bạn là CyberAssistant - Hệ thống Trí tuệ nhân tạo chuyên gia giám sát ATTT của học viện Coursera.\n"
        f"Học viên hiện tại đang nghiên cứu lộ trình chuyên ngành: {course_id}.\n"
        "Nhiệm vụ: Hãy trả lời các câu hỏi kỹ thuật, gỡ lỗi mã nguồn chuyên sâu (Python, C++), giải thích log mạng "
        "và mánh khóe tấn công một cách chuyên nghiệp, thông thái, dễ hiểu. Tuyệt đối KHÔNG cung cấp mã độc thô nguy hiểm cho học viên."
    )
    
    try:
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=system_instruction
        )
        response = model.generate_content(user_message)
        return jsonify({"reply": response.text}), 200
    except Exception as e:
        print(f"Lỗi kết nối Gemini API: {e}")
        return jsonify({"reply": f"🤖 [CyberAI Monitor] Đã ghi nhận truy vấn về phân hệ khóa học '{course_id}'. Bạn hãy kết hợp gõ lệnh payload chuyên dụng và kiểm thử mã băm trên cửa sổ Kali Linux Sandbox để hoàn thành bài thực hành nhé!"}), 200

@app.route('/api/user/activate-course', methods=['POST'])
def activate_course():
    auth_header = request.headers.get('Authorization')
    user_id = None
    if auth_header and 'Bearer ' in auth_header:
        token_jwt = auth_header.split(' ')[1]
        try:
            payload = jwt.decode(token_jwt, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            return jsonify({"message": "Phiên làm việc hết hạn, vui lòng đăng nhập lại!"}), 401
    else:
        user_id = 1

    data = request.get_json() or {}
    token_input = data.get('token', '').strip()
    
    if not token_input:
        return jsonify({"message": "Vui lòng nhập mã Token kích hoạt!"}), 400

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT course_id, is_used FROM activation_tokens WHERE token = %s", (token_input,))
        token_data = cursor.fetchone()
        
        if not token_data:
            return jsonify({"message": "Mã kích hoạt bảo mật không tồn tại trên hệ thống!"}), 444
            
        if token_data['is_used']:
            return jsonify({"message": "Mã kích hoạt Token này đã được sử dụng từ trước!"}), 400
            
        course_id = token_data['course_id']
        
        cursor.execute("UPDATE activation_tokens SET is_used = TRUE WHERE token = %s", (token_input,))
        
        cursor.execute("SELECT id FROM orders WHERE user_id = %s AND course_name = %s", (user_id, course_id))
        existing_order = cursor.fetchone()
        
        if existing_order:
            cursor.execute("UPDATE orders SET current_step = 3 WHERE id = %s", (existing_order['id'],))
        else:
            cursor.execute("INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (%s, %s, 0, 3, NOW())", (user_id, course_id))
            
        db.commit()
        return jsonify({"message": "Xác thực kích hoạt khóa học thành công! Hệ thống Lab đã mở khóa.", "course_id": course_id}), 200
    except Exception as e:
        print("Lỗi API kích hoạt khóa học:", e)
        return jsonify({"message": "Lỗi máy chủ cơ sở dữ liệu."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/lessons/submit-flag', methods=['POST'])
def submit_lesson_flag():
    auth_header = request.headers.get('Authorization')
    user_id = None
    if auth_header and 'Bearer ' in auth_header:
        token_jwt = auth_header.split(' ')[1]
        try:
            payload = jwt.decode(token_jwt, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            return jsonify({"message": "Phiên làm việc không hợp lệ!"}), 401
    else:
        user_id = 1

    data = request.get_json() or {}
    lesson_id = data.get('lesson_id')
    flag_input = data.get('flag', '').strip()
    
    if not lesson_id or not flag_input:
        return jsonify({"message": "Vui lòng nhập chuỗi ký tự Flag CTF bài Lab!"}), 400

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT flag FROM lessons WHERE id = %s", (lesson_id,))
        row = cursor.fetchone()
        
        if not row or not row['flag']:
            return jsonify({"message": "Module bài học này không có cấu hình thử thách Flag CTF!"}), 400
            
        if flag_input == row['flag']:
            cursor.execute("INSERT IGNORE INTO user_progress (user_id, lesson_id) VALUES (%s, %s)", (user_id, lesson_id))
            db.commit()
            return jsonify({"success": True, "message": "Chính xác hoàn toàn! Tiến trình module đã được tích xanh tự động."}), 200
        else:
            return jsonify({"success": False, "message": "Sai cấu trúc Flag! Chuỗi mật mã băm trích xuất không trùng khớp."}), 200
    except Exception as e:
        print("Lỗi API chấm bài CTF:", e)
        return jsonify({"message": "Lỗi hệ thống máy chủ nội bộ."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/user/certificate/<course_id>', methods=['GET'])
def get_certificate_data(course_id):
    auth_header = request.headers.get('Authorization')
    fullname = "Chuyên Gia An Toàn Thông Tin"
    if auth_header and 'Bearer ' in auth_header:
        try:
            token_jwt = auth_header.split(' ')[1]
            payload = jwt.decode(token_jwt, app.config['SECRET_KEY'], algorithms=['HS256'])
            fullname = payload.get('fullname', "Chuyên Gia An Toàn Thông Tin")
        except:
            pass

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)
    
    try:
        cursor.execute("SELECT title FROM courses WHERE id = %s", (course_id,))
        course_row = cursor.fetchone()
        
        if not course_row:
            return jsonify({"message": "Mã định danh lộ trình khóa học không hợp lệ!"}), 404
            
        current_date = datetime.datetime.now().strftime('%d-%m-%Y')
        return jsonify({
            "status": "ISSUED",
            "fullname": fullname,
            "course_title": course_row['title'],
            "cert_id": f"CERT-SEC-{course_id.upper()}-2026",
            "date": current_date
        }), 200
    except Exception as e:
        print("Lỗi API Certificate:", e)
        return jsonify({"message": "Lỗi trích xuất cấu trúc dữ liệu phôi chứng chỉ."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/payment/checkout', methods=['POST'])
def payment_checkout():
    auth_header = request.headers.get('Authorization')
    user_id = 1 
    if auth_header and 'Bearer ' in auth_header:
        try:
            token = auth_header.split(' ')[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            return jsonify({"message": "Phiên làm việc hết hạn!"}), 401

    data = request.get_json() or {}
    course_id = data.get('course_id')

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute("SELECT title, price FROM courses WHERE id = %s", (course_id,))
        course = cursor.fetchone()
        if not course:
            return jsonify({"message": "Khóa học không tồn tại!"}), 404

        price = int(course['price'])
        
        cursor.execute("SELECT id FROM orders WHERE user_id = %s AND course_name = %s", (user_id, course_id))
        existing_order = cursor.fetchone()
        
        order_id = None
        if not existing_order:
            cursor.execute(
                "INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (%s, %s, %s, 1, NOW())",
                (user_id, course_id, price)
            )
            db.commit()
            order_id = cursor.lastrowid
        else:
            order_id = existing_order['id']

        bank_id = "MB"
        account_no = "0999999999" 
        account_name = "HOC VIEN COURSERA ATTT"
        memo = f"ATTT {order_id}"
        
        encoded_memo = urllib.parse.quote(memo)
        encoded_name = urllib.parse.quote(account_name)
        
        qr_url = f"https://api.vietqr.io/image/{bank_id}-{account_no}-qr_only.png?amount={price}&addInfo={encoded_memo}&accountName={encoded_name}"

        return jsonify({
            "status": "PENDING",
            "course_title": course['title'],
            "price": price,
            "memo": memo,
            "qr_url": qr_url,
            "order_id": order_id
        }), 200

    except Exception as e:
        print("Lỗi hệ thống Checkout:", e)
        return jsonify({"message": "Lỗi xử lý cổng thanh toán."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/payment/apply-discount', methods=['POST'])
def apply_discount():
    auth_header = request.headers.get('Authorization')
    user_id = 1
    if auth_header and 'Bearer ' in auth_header:
        try:
            token = auth_header.split(' ')[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            return jsonify({"message": "Phiên làm việc hết hạn!"}), 401

    data = request.get_json() or {}
    order_id = data.get('order_id')
    code = data.get('code', '').strip().upper()

    if not order_id or not code:
        return jsonify({"message": "Thiếu thông tin mã giảm giá hoặc đơn hàng!"}), 400

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)

    try:
        # Kiểm tra mã giảm giá trong CSDL
        cursor.execute("SELECT discount_rate FROM discount_codes WHERE code = %s AND is_active = TRUE", (code,))
        discount_row = cursor.fetchone()
        
        if not discount_row:
            return jsonify({"message": "Mã giảm giá không hợp lệ hoặc đã không còn hoạt động!"}), 400
            
        discount_rate = float(discount_row['discount_rate'])

        cursor.execute("SELECT o.id, c.price as original_price FROM orders o JOIN courses c ON o.course_name = c.id WHERE o.id = %s AND o.user_id = %s", (order_id, user_id))
        order_row = cursor.fetchone()

        if not order_row:
            return jsonify({"message": "Đơn hàng không hợp lệ!"}), 404

        original_price = int(order_row['original_price'])
        new_price = int(original_price * (1 - discount_rate))

        cursor.execute("UPDATE orders SET price = %s WHERE id = %s", (new_price, order_id))
        db.commit()

        bank_id, account_no, account_name = "MB", "0999999999", "HOC VIEN COURSERA ATTT"
        memo = f"ATTT {order_id}"
        
        qr_url = f"https://api.vietqr.io/image/{bank_id}-{account_no}-qr_only.png?amount={new_price}&addInfo={urllib.parse.quote(memo)}&accountName={urllib.parse.quote(account_name)}"

        return jsonify({"message": f"Áp dụng thành công! Đã giảm {int(discount_rate * 100)}%", "new_price": new_price, "original_price": original_price, "qr_url": qr_url}), 200
    except Exception as e:
        print("Lỗi apply discount:", e)
        return jsonify({"message": "Lỗi hệ thống khi áp dụng mã."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/payment/mock-webhook', methods=['POST'])
def mock_payment_webhook():
    auth_header = request.headers.get('Authorization')
    user_id = 1
    if auth_header and 'Bearer ' in auth_header:
        try:
            token = auth_header.split(' ')[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            pass

    data = request.get_json() or {}
    course_id = data.get('course_id')

    db = get_db_connection()
    cursor = db.cursor()

    try:
        # Chỉ phản hồi cho Frontend biết là đã ghi nhận, giữ nguyên trạng thái current_step = 1 (Chờ duyệt)
        return jsonify({"success": True, "message": "Đã gửi yêu cầu xác nhận! Vui lòng chờ Admin duyệt để cấp quyền vào học."}), 200
    except Exception as e:
        return jsonify({"message": "Lỗi kích hoạt"}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/payment/cart-checkout', methods=['POST'])
def payment_cart_checkout():
    auth_header = request.headers.get('Authorization')
    user_id = 1 
    if auth_header and 'Bearer ' in auth_header:
        try:
            token = auth_header.split(' ')[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            return jsonify({"message": "Phiên làm việc hết hạn!"}), 401

    data = request.get_json() or {}
    course_ids = data.get('course_ids', [])

    if not course_ids:
        return jsonify({"message": "Giỏ hàng trống!"}), 400

    db = get_db_connection()
    cursor = db.cursor(dictionary=True)

    try:
        total_price = 0
        format_strings = ','.join(['%s'] * len(course_ids))
        cursor.execute(f"SELECT id, title, price FROM courses WHERE id IN ({format_strings})", tuple(course_ids))
        courses = cursor.fetchall()
        
        if not courses:
            return jsonify({"message": "Khóa học không tồn tại!"}), 404

        order_ids = []
        for c in courses:
            total_price += int(c['price'])
            cursor.execute("SELECT id FROM orders WHERE user_id = %s AND course_name = %s", (user_id, c['id']))
            existing = cursor.fetchone()
            if existing:
                order_ids.append(str(existing['id']))
            else:
                cursor.execute("INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (%s, %s, %s, 1, NOW())", (user_id, c['id'], c['price']))
                order_ids.append(str(cursor.lastrowid))
        
        db.commit()
        cart_order_id = "CART_" + "_".join(order_ids)

        memo = f"COURSERA USER{user_id} CART"
        encoded_memo = urllib.parse.quote(memo)
        encoded_name = urllib.parse.quote("HOC VIEN COURSERA")
        qr_url = f"https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={total_price}&addInfo={encoded_memo}&accountName={encoded_name}"

        return jsonify({
            "status": "PENDING",
            "price": total_price,
            "memo": memo,
            "qr_url": qr_url,
            "order_id": cart_order_id
        }), 200

    except Exception as e:
        print("Lỗi hệ thống Cart Checkout:", e)
        return jsonify({"message": "Lỗi xử lý cổng thanh toán."}), 500
    finally:
        cursor.close()
        db.close()

@app.route('/api/payment/mock-webhook-cart', methods=['POST'])
def mock_payment_webhook_cart():
    auth_header = request.headers.get('Authorization')
    user_id = 1
    if auth_header and 'Bearer ' in auth_header:
        try:
            token = auth_header.split(' ')[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload['user_id']
        except:
            pass

    data = request.get_json() or {}
    order_id = data.get('order_id', '')

    db = get_db_connection()
    cursor = db.cursor()

    try:
        if order_id.startswith("CART_"):
            ids_str = order_id.replace("CART_", "").split("_")
            for oid in ids_str:
                if oid:
                    cursor.execute("UPDATE orders SET current_step = 3 WHERE id = %s AND user_id = %s", (oid, user_id))
            db.commit()
            return jsonify({"success": True, "message": "Thanh toán giỏ hàng thành công. Các khóa học đã mở khóa!"}), 200
        else:
            return jsonify({"message": "Mã đơn hàng không hợp lệ!"}), 400
    except Exception as e:
        print("Lỗi webhook giỏ hàng:", e)
        return jsonify({"message": "Lỗi kích hoạt"}), 500
    finally:
        cursor.close()
        db.close()

# ========================================================
# API MỚI 16: ĐÁNH GIÁ KHÓA HỌC (REVIEW/RATING)
# ========================================================
@app.route('/api/courses/review', methods=['POST'])
def submit_course_review():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối!"}), 401
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        data = request.get_json() or {}
        course_id = data.get('course_id')
        rating = data.get('rating')
        comment = data.get('comment', '')
        
        if not course_id or not rating:
            return jsonify({"message": "Vui lòng cung cấp đủ thông tin đánh giá!"}), 400
        
        db = get_db_connection()
        cursor = db.cursor()
        cursor.execute("INSERT INTO course_reviews (user_id, course_id, rating, comment) VALUES (%s, %s, %s, %s)", (user_id, course_id, rating, comment))
        db.commit()
        cursor.close()
        db.close()
        
        return jsonify({"success": True, "message": "Cảm ơn bạn! Đánh giá của bạn đã được ghi nhận trên hệ thống."}), 200
    except Exception as e:
        print("Lỗi API Đánh giá khóa học:", e)
        return jsonify({"message": "Lỗi hệ thống máy chủ nội bộ."}), 500

# ========================================================
# API CHO ADMIN
# ========================================================
@app.route('/api/admin/orders', methods=['GET'])
def admin_get_orders():
    # Bước 1: Xác thực quyền Admin
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập vào tài nguyên này."}), 403

        # Bước 2: Lấy tất cả đơn hàng
        cursor.execute("SELECT o.id, o.course_name, o.price, o.current_step, o.created_at, u.fullname as user_fullname, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.id DESC")
        all_orders = cursor.fetchall()
        for order in all_orders:
            order['created_at'] = order['created_at'].strftime('%d/%m/%Y %H:%M')

        cursor.close()
        db_conn.close()
        return jsonify({"orders": all_orders}), 200
    except Exception as e:
        print("Lỗi API Admin Orders:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/approve-order/<int:order_id>', methods=['POST'])
def admin_approve_order(order_id):
    # Xác thực quyền Admin
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập vào tài nguyên này."}), 403

        # Cập nhật trạng thái đơn hàng
        cursor.execute("UPDATE orders SET current_step = 3 WHERE id = %s", (order_id,))
        
        # Lấy thông tin user và khóa học để gửi email
        cursor.execute("""
            SELECT o.id, o.price, u.email, u.fullname, o.course_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.id = %s
        """, (order_id,))
        order_info = cursor.fetchone()
        
        course_title = "Gói học tập Coursera"
        if order_info and order_info['course_name']:
            cursor.execute("SELECT title FROM courses WHERE id = %s", (order_info['course_name'],))
            c = cursor.fetchone()
            if c and c['title']:
                course_title = c['title']
                
        db_conn.commit()
        cursor.close()
        db_conn.close()
        
        # Gửi Email đính kèm hóa đơn Text
        if order_info and order_info['email']:
            price_val = int(order_info['price'] or 0)
            html_body = f"<h3>Chào {order_info['fullname']},</h3><p>Đơn hàng ghi danh khóa học <b style='color:#0056D2;'>{course_title}</b> của bạn đã được duyệt thành công!</p><p>Bạn có thể đăng nhập vào hệ thống để bắt đầu học và thực hành ngay bây giờ.</p><br><p>Trân trọng,<br>Ban Quản trị Coursera Advanced</p>"
            
            invoice_txt = f"HOA DON THANH TOAN DIEN TU\n--------------------------\nMa don hang: #{order_info['id']}\nKhach hang: {order_info['fullname']}\nKhoa hoc: {course_title}\nTong tien: {price_val:,} VND\nTrang thai: Da thanh toan\n\nCam on ban da su dung dich vu cua chung toi!"
            
            send_notification_email(order_info['email'], f"Xác nhận ghi danh: {course_title}", html_body, f"Hoa_Don_{order_info['id']}.txt", invoice_txt.encode('utf-8'))
            
        return jsonify({"success": True, "message": f"Đã duyệt thành công đơn hàng #{order_id}."}), 200

    except Exception as e:
        print(f"Lỗi duyệt đơn hàng #{order_id}:", e)
        return jsonify({"message": "Lỗi máy chủ khi duyệt đơn hàng."}), 500

@app.route('/api/admin/cancel-order/<int:order_id>', methods=['POST'])
def admin_cancel_order(order_id):
    # Xác thực quyền Admin
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        # Cập nhật trạng thái đơn hàng thành 4 (Đã hủy/Từ chối)
        cursor.execute("UPDATE orders SET current_step = 4 WHERE id = %s", (order_id,))
        
        # Lấy thông tin để gửi thông báo
        cursor.execute("""
            SELECT o.id, u.email, u.fullname, o.course_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.id = %s
        """, (order_id,))
        order_info = cursor.fetchone()
        
        course_title = "Gói học tập Coursera"
        if order_info and order_info['course_name']:
            cursor.execute("SELECT title FROM courses WHERE id = %s", (order_info['course_name'],))
            c = cursor.fetchone()
            if c and c['title']:
                course_title = c['title']
                
        db_conn.commit()
        cursor.close()
        db_conn.close()
        
        # Gửi Email từ chối
        if order_info and order_info['email']:
            html_body = f"<h3>Chào {order_info['fullname']},</h3><p>Rất tiếc, đơn hàng đăng ký khóa học <b>{course_title}</b> của bạn đã bị Hủy/Từ chối do giao dịch chưa hoàn tất hoặc không hợp lệ.</p><p>Vui lòng tạo một đơn hàng mới hoặc liên hệ với bộ phận hỗ trợ nếu bạn cần giúp đỡ.</p><br><p>Trân trọng,<br>Ban Quản trị Coursera</p>"
            send_notification_email(order_info['email'], f"Thông báo Hủy đơn hàng #{order_info['id']}", html_body)
            
        return jsonify({"success": True, "message": f"Đã hủy đơn hàng #{order_id}."}), 200
    except Exception as e:
        print(f"Lỗi hủy đơn hàng #{order_id}:", e)
        return jsonify({"message": "Lỗi máy chủ khi hủy đơn hàng."}), 500

@app.route('/api/admin/orders/<int:order_id>', methods=['DELETE'])
def admin_delete_order(order_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập vào tài nguyên này."}), 403

        cursor.execute("DELETE FROM orders WHERE id = %s", (order_id,))
        db_conn.commit()

        cursor.close()
        db_conn.close()
        return jsonify({"message": "Xóa đơn hàng thành công."}), 200

    except Exception as e:
        print(f"Lỗi xóa đơn hàng #{order_id}:", e)
        return jsonify({"message": "Lỗi máy chủ khi xóa đơn hàng."}), 500

@app.route('/api/admin/users', methods=['GET'])
def admin_get_users():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        cursor.execute("SELECT id, fullname, email, role, created_at FROM users ORDER BY id DESC")
        all_users = cursor.fetchall()
        for u in all_users:
            u['created_at'] = u['created_at'].strftime('%d/%m/%Y')

        cursor.close()
        db_conn.close()
        return jsonify({"users": all_users}), 200
    except Exception as e:
        print("Lỗi API Admin Users:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/users', methods=['POST'])
def admin_add_user():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        data = request.get_json()
        fullname = data.get('fullname')
        email = data.get('email')
        password = data.get('password')
        role = data.get('role', 'student')

        if not fullname or not email or not password:
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Vui lòng điền đầy đủ thông tin!"}), 400

        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Email này đã được sử dụng!"}), 409

        hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cursor.execute("INSERT INTO users (fullname, email, password_hash, role) VALUES (%s, %s, %s, %s)", (fullname, email, hashed_password, role))
        db_conn.commit()
        cursor.close()
        db_conn.close()
        return jsonify({"message": "Thêm người dùng thành công"}), 201
    except Exception as e:
        print("Lỗi Add User:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
def admin_update_user(user_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        admin_user = cursor.fetchone()
        
        if not admin_user or admin_user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        data = request.get_json()
        fullname = data.get('fullname')
        email = data.get('email')
        role = data.get('role')
        password = data.get('password')

        cursor.execute("SELECT id FROM users WHERE email = %s AND id != %s", (email, user_id))
        if cursor.fetchone():
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Email đã được sử dụng bởi tài khoản khác."}), 409

        if password:
            hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            cursor.execute("UPDATE users SET fullname = %s, email = %s, role = %s, password_hash = %s WHERE id = %s", 
                           (fullname, email, role, hashed_password, user_id))
        else:
            cursor.execute("UPDATE users SET fullname = %s, email = %s, role = %s WHERE id = %s", 
                           (fullname, email, role, user_id))
        
        db_conn.commit()
        cursor.close()
        db_conn.close()
        return jsonify({"message": "Cập nhật thông tin người dùng thành công."}), 200
    except Exception as e:
        print(f"Lỗi cập nhật user #{user_id}:", e)
        return jsonify({"message": "Lỗi máy chủ."}), 500

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        
        if payload['user_id'] == user_id:
            return jsonify({"message": "Bạn không thể tự xóa tài khoản của mình."}), 400

        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        admin_user = cursor.fetchone()
        
        if not admin_user or admin_user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        db_conn.commit()

        if cursor.rowcount == 0:
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Không tìm thấy người dùng để xóa."}), 404

        cursor.close()
        db_conn.close()
        return jsonify({"message": "Xóa người dùng thành công."}), 200
    except Exception as e:
        print(f"Lỗi xóa user #{user_id}:", e)
        return jsonify({"message": "Lỗi máy chủ."}), 500

@app.route('/api/admin/invoice/<int:order_id>', methods=['GET'])
def admin_get_invoice(order_id):
    token = request.args.get('token')
    if not token:
        return "Quyền truy cập bị từ chối.", 401
    
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['user_id']
        
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return "Bạn không có quyền truy cập.", 403

        cursor.execute("""
            SELECT o.id, o.course_name, o.price, o.current_step, o.created_at, 
                   u.fullname as user_fullname, u.email as user_email 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            WHERE o.id = %s
        """, (order_id,))
        order = cursor.fetchone()
        cursor.close()
        db_conn.close()

        if not order:
            return "Không tìm thấy đơn hàng.", 404

        status_str = "Hoàn thành (Đã thanh toán)" if order['current_step'] == 3 else "Chờ duyệt (Chưa thanh toán)"
        created_date = order['created_at'].strftime('%d/%m/%Y %H:%M') if hasattr(order['created_at'], 'strftime') else str(order['created_at'])
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Hóa đơn #{order['id']}</title>
            <style>
                body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #333; background: #f4f7f6; }}
                .invoice-box {{ max-width: 800px; margin: auto; padding: 40px; border: 1px solid #eee; box-shadow: 0 4px 12px rgba(0, 0, 0, .1); font-size: 15px; line-height: 24px; background: #fff; border-radius: 8px; }}
                .header {{ display: flex; justify-content: space-between; border-bottom: 2px solid #0056D2; padding-bottom: 20px; margin-bottom: 30px; }}
                .title {{ color: #0056D2; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; }}
                .details {{ display: flex; justify-content: space-between; margin-bottom: 40px; }}
                .details div {{ width: 48%; }}
                table {{ width: 100%; text-align: left; border-collapse: collapse; margin-bottom: 20px; }}
                th, td {{ padding: 15px 10px; border-bottom: 1px solid #eaeaea; }}
                th {{ background: #f9fbff; color: #0056D2; font-weight: bold; text-transform: uppercase; font-size: 13px; }}
                .total-row {{ font-weight: bold; font-size: 18px; color: #0056D2; }}
                .total-row td {{ border-bottom: none; border-top: 2px solid #0056D2; }}
                .footer {{ text-align: center; margin-top: 50px; font-size: 13px; color: #888; border-top: 1px solid #eee; padding-top: 20px; }}
                .btn-print {{ display: inline-block; padding: 12px 24px; background: #0056D2; color: white; text-decoration: none; border: none; cursor: pointer; border-radius: 6px; font-weight: bold; font-size: 14px; transition: background 0.3s; }}
                .btn-print:hover {{ background: #0043a8; }}
                @media print {{ 
                    body {{ background: #fff; padding: 0; }}
                    .invoice-box {{ box-shadow: none; border: none; padding: 0; }}
                    .no-print {{ display: none !important; }} 
                }}
            </style>
        </head>
        <body>
            <div class="invoice-box">
                <div class="header">
                    <div class="title">coursera<span style="font-size:14px; font-weight:normal; color:#555; display:block;">Advanced Information Security</span></div>
                    <div style="text-align: right;">
                        <strong style="font-size: 18px;">HÓA ĐƠN ĐIỆN TỬ</strong><br>
                        Mã số: <strong>INV-{order['id']:05d}</strong><br>
                        Ngày lập: {created_date}
                    </div>
                </div>
                <div class="details">
                    <div>
                        <strong style="color: #888; text-transform: uppercase; font-size: 12px;">Thông tin khách hàng:</strong><br>
                        <strong>{order['user_fullname']}</strong><br>
                        {order['user_email']}
                    </div>
                    <div style="text-align: right;">
                        <strong style="color: #888; text-transform: uppercase; font-size: 12px;">Trạng thái thanh toán:</strong><br>
                        <strong style="color: {'#28a745' if order['current_step'] == 3 else '#ffc107'};">{status_str}</strong>
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Sản phẩm / Khóa học ghi danh</th>
                            <th style="text-align: right;">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{order['course_name'].replace(',', ', ')}</td>
                            <td style="text-align: right;">{int(order['price']):,} đ</td>
                        </tr>
                        <tr class="total-row">
                            <td style="text-align: right;">TỔNG CỘNG:</td>
                            <td style="text-align: right;">{int(order['price']):,} đ</td>
                        </tr>
                    </tbody>
                </table>
                <div class="footer">
                    <p>Cảm ơn bạn đã đồng hành cùng Coursera Advanced!</p>
                    <p>Đây là hóa đơn điện tử hợp lệ được xuất tự động từ hệ thống.</p>
                    <div class="no-print" style="margin-top: 30px;">
                        <button class="btn-print" onclick="window.print()">In / Lưu dưới dạng PDF</button>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """
        return html_content, 200

    except Exception as e:
        print("Lỗi API Invoice:", e)
        return "Lỗi máy chủ nội bộ.", 500

@app.route('/api/admin/revenue', methods=['GET'])
def admin_get_revenue():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        # Tính tổng doanh thu theo ngày trong 30 ngày gần nhất (những đơn đã Hoàn thành)
        cursor.execute("""
            SELECT DATE(created_at) as date, SUM(price) as total_revenue 
            FROM orders 
            WHERE current_step = 3 
            GROUP BY DATE(created_at) 
            ORDER BY date ASC 
            LIMIT 30
        """)
        revenue_data = cursor.fetchall()
        
        for row in revenue_data:
            row['date'] = row['date'].strftime('%d/%m/%Y') if hasattr(row['date'], 'strftime') else str(row['date'])

        cursor.close()
        db_conn.close()
        return jsonify({"revenue": revenue_data}), 200
    except Exception as e:
        print("Lỗi API Admin Revenue:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/upload', methods=['POST'])
def admin_upload_file():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        cursor.close()
        db_conn.close()
        
        if not user or user.get('role') not in ['admin', 'teacher']:
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        if 'file' not in request.files:
            return jsonify({'message': 'Không tìm thấy file.'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'message': 'Chưa chọn file.'}), 400
            
        if file:
            filename = secure_filename(file.filename)
            unique_filename = f"{uuid.uuid4().hex}_{filename}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            file.save(file_path)
            
            file_url = f"http://127.0.0.1:5000/uploads/{unique_filename}"
            return jsonify({'message': 'Upload thành công', 'url': file_url}), 200

    except Exception as e:
        print("Lỗi API Upload:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/courses/<course_id>', methods=['PUT'])
def admin_update_course(course_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        
        if not user or user.get('role') not in ['admin', 'teacher']:
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        data = request.get_json()
        title = data.get('title')
        badge = data.get('badge')
        icon = data.get('icon')

        cursor.execute("""
            UPDATE courses 
            SET title = %s, badge = %s, icon = %s
            WHERE id = %s
        """, (title, badge, icon, course_id))
        
        db_conn.commit()
        cursor.close()
        db_conn.close()
        
        return jsonify({"message": "Cập nhật khóa học thành công."}), 200
    except Exception as e:
        print("Lỗi API Update Course:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/courses', methods=['GET'])
def admin_get_courses():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        
        if not user or user.get('role') not in ['admin', 'teacher']:
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        cursor.execute("SELECT id, title, original_price, price, badge, color, icon FROM courses")
        courses = cursor.fetchall()
        
        for course_item in courses:
            c_id = course_item['id']
            cursor.execute("SELECT id, week_number, title FROM course_weeks WHERE course_id = %s ORDER BY week_number", (c_id,))
            weeks = cursor.fetchall()
            
            for week in weeks:
                cursor.execute("SELECT id, type, title, duration, video_url, description, quiz_question, quiz_option_a, quiz_option_b, quiz_correct_answer, flag FROM lessons WHERE week_id = %s ORDER BY id", (week['id'],))
                lessons = cursor.fetchall()
                week['items'] = lessons
                
            course_item['weeks'] = weeks

        cursor.close()
        db_conn.close()
        return jsonify({"courses": courses}), 200
    except Exception as e:
        print("Lỗi API Admin Get Courses:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/courses', methods=['POST'])
def admin_add_course():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        
        if not user or user.get('role') not in ['admin', 'teacher']:
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        data = request.get_json()
        course_id = data.get('id')
        title = data.get('title')
        price = data.get('price', 0)
        badge = data.get('badge', 'Mới')
        icon = data.get('icon', '')

        if not course_id or not title:
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Thiếu mã định danh (ID) hoặc Tiêu đề khóa học!"}), 400

        cursor.execute("""
            INSERT INTO courses (id, title, original_price, price, badge, color, icon) 
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (course_id, title, price, price, badge, 'from-gray-600 to-slate-800', icon))
        
        db_conn.commit()
        cursor.close()
        db_conn.close()
        
        return jsonify({"message": "Thêm khóa học mới thành công."}), 201
    except Exception as e:
        print("Lỗi API Add Course:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/courses/<course_id>', methods=['DELETE'])
def admin_delete_course(course_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        if not user or user.get('role') not in ['admin', 'teacher']:
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        # Tính năng Xóa dây chuyền (Cascade Delete): Xóa các bài học và tuần học bên trong trước
        cursor.execute("SELECT id FROM course_weeks WHERE course_id = %s", (course_id,))
        weeks = cursor.fetchall()
        for w in weeks:
            cursor.execute("SELECT id FROM lessons WHERE week_id = %s", (w['id'],))
            lessons = cursor.fetchall()
            for l in lessons:
                cursor.execute("DELETE FROM user_progress WHERE lesson_id = %s", (l['id'],))
            cursor.execute("DELETE FROM lessons WHERE week_id = %s", (w['id'],))
        cursor.execute("DELETE FROM course_weeks WHERE course_id = %s", (course_id,))
        cursor.execute("DELETE FROM courses WHERE id = %s", (course_id,))
        db_conn.commit()
        cursor.close()
        db_conn.close()
        
        return jsonify({"message": "Xóa khóa học thành công."}), 200
    except Exception as e:
        print("Lỗi API Delete Course:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ. Vui lòng xóa các bài học bên trong trước."}), 500

@app.route('/api/admin/courses/<course_id>/weeks', methods=['POST'])
def admin_add_week(course_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header: return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        if not user or user.get('role') not in ['admin', 'teacher']: return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        data = request.get_json()
        week_number = data.get('week_number', 1)
        title = data.get('title', 'Tuần mới')

        cursor.execute("INSERT INTO course_weeks (course_id, week_number, title) VALUES (%s, %s, %s)", (course_id, week_number, title))
        db_conn.commit()
        cursor.close()
        db_conn.close()
        return jsonify({"message": "Thêm tuần học mới thành công."}), 201
    except Exception as e:
        print("Lỗi Add Week:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/weeks/<int:week_id>', methods=['DELETE'])
def admin_delete_week(week_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header: return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        if not user or user.get('role') not in ['admin', 'teacher']: return jsonify({"message": "Quyền truy cập bị từ chối."}), 403
        
        # Tính năng Xóa dây chuyền (Cascade Delete): Xóa các bài học con trước
        cursor.execute("SELECT id FROM lessons WHERE week_id = %s", (week_id,))
        lessons = cursor.fetchall()
        for l in lessons:
            cursor.execute("DELETE FROM user_progress WHERE lesson_id = %s", (l['id'],))
        cursor.execute("DELETE FROM lessons WHERE week_id = %s", (week_id,))
        cursor.execute("DELETE FROM course_weeks WHERE id = %s", (week_id,))
        db_conn.commit()
        cursor.close()
        db_conn.close()
        return jsonify({"message": "Xóa tuần học thành công."}), 200
    except Exception as e:
        print("Lỗi Delete Week:", e)
        return jsonify({"message": "Vui lòng xóa tất cả các bài học bên trong tuần này trước."}), 500

@app.route('/api/admin/weeks/<int:week_id>/lessons', methods=['POST'])
def admin_add_lesson(week_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header: return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        if not user or user.get('role') not in ['admin', 'teacher']: return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        data = request.get_json()
        title = data.get('title', 'Bài học mới')
        l_type = data.get('type', 'video')

        cursor.execute("INSERT INTO lessons (week_id, type, title, duration) VALUES (%s, %s, %s, %s)", (week_id, l_type, title, 10))
        db_conn.commit()
        cursor.close()
        db_conn.close()
        return jsonify({"message": "Thêm bài học mới thành công."}), 201
    except Exception as e:
        print("Lỗi Add Lesson:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/lessons/<int:lesson_id>', methods=['PUT'])
def admin_update_lesson(lesson_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header: return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        if not user or user.get('role') not in ['admin', 'teacher']: return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        data = request.get_json()
        cursor.execute("""
            UPDATE lessons 
            SET title=%s, video_url=%s, description=%s, quiz_question=%s, quiz_option_a=%s, quiz_option_b=%s, quiz_correct_answer=%s, flag=%s
            WHERE id=%s
        """, (data.get('title'), data.get('video_url'), data.get('description'), data.get('quiz_question'), data.get('quiz_option_a'), data.get('quiz_option_b'), data.get('quiz_correct_answer'), data.get('flag'), lesson_id))
        db_conn.commit()
        cursor.close()
        db_conn.close()
        return jsonify({"message": "Cập nhật bài học thành công."}), 200
    except Exception as e:
        print("Lỗi Update Lesson:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/lessons/<int:lesson_id>', methods=['DELETE'])
def admin_delete_lesson(lesson_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header: return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        if not user or user.get('role') not in ['admin', 'teacher']: return jsonify({"message": "Bạn không có quyền truy cập."}), 403
        
        cursor.execute("DELETE FROM user_progress WHERE lesson_id = %s", (lesson_id,))
        cursor.execute("DELETE FROM lessons WHERE id = %s", (lesson_id,))
        db_conn.commit()
        cursor.close()
        db_conn.close()
        return jsonify({"message": "Xóa bài học thành công."}), 200
    except Exception as e:
        print("Lỗi Delete Lesson:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

# ========================================================
# API QUẢN LÝ MĂ GIẢM GIÁ (ADMIN)
# ========================================================
@app.route('/api/admin/discounts', methods=['GET', 'POST'])
def admin_manage_discounts():
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor(dictionary=True)
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        
        if not user or user.get('role') != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        if request.method == 'GET':
            cursor.execute("SELECT * FROM discount_codes ORDER BY id DESC")
            discounts = cursor.fetchall()
            for d in discounts:
                d['created_at'] = d['created_at'].strftime('%d/%m/%Y %H:%M') if d['created_at'] else ''
                d['discount_rate'] = float(d['discount_rate'])
            cursor.close()
            db_conn.close()
            return jsonify({"discounts": discounts}), 200
            
        if request.method == 'POST':
            data = request.get_json()
            code = data.get('code', '').strip().upper()
            rate = float(data.get('rate', 0)) / 100.0  # Frontend gửi 50 -> 0.5
            
            if not code or rate <= 0:
                cursor.close()
                db_conn.close()
                return jsonify({"message": "Dữ liệu không hợp lệ!"}), 400
                
            cursor.execute("SELECT id FROM discount_codes WHERE code = %s", (code,))
            if cursor.fetchone():
                cursor.close()
                db_conn.close()
                return jsonify({"message": "Mã này đã tồn tại!"}), 409
                
            cursor.execute("INSERT INTO discount_codes (code, discount_rate) VALUES (%s, %s)", (code, rate))
            db_conn.commit()
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Thêm mã giảm giá thành công."}), 201
            
    except Exception as e:
        print("Lỗi Manage Discounts:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

@app.route('/api/admin/discounts/<int:disc_id>', methods=['DELETE', 'PUT'])
def admin_update_discount(disc_id):
    auth_header = request.headers.get('Authorization')
    if not auth_header or 'Bearer ' not in auth_header:
        return jsonify({"message": "Quyền truy cập bị từ chối."}), 401
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db_conn = get_db_connection()
        cursor = db_conn.cursor()
        
        cursor.execute("SELECT role FROM users WHERE id = %s", (payload['user_id'],))
        user = cursor.fetchone()
        if not user or user[0] != 'admin':
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Bạn không có quyền truy cập."}), 403

        if request.method == 'DELETE':
            cursor.execute("DELETE FROM discount_codes WHERE id = %s", (disc_id,))
            db_conn.commit()
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Xóa mã giảm giá thành công."}), 200
            
        if request.method == 'PUT':
            data = request.get_json()
            is_active = data.get('is_active')
            cursor.execute("UPDATE discount_codes SET is_active = %s WHERE id = %s", (is_active, disc_id))
            db_conn.commit()
            cursor.close()
            db_conn.close()
            return jsonify({"message": "Cập nhật trạng thái thành công."}), 200
            
    except Exception as e:
        print("Lỗi Update Discount:", e)
        return jsonify({"message": "Lỗi máy chủ nội bộ."}), 500

def init_db():
    try:
        db = get_db_connection()
        cursor = db.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS discount_codes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                code VARCHAR(50) UNIQUE NOT NULL,
                discount_rate DECIMAL(4,2) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Khởi tạo dữ liệu mẫu nếu bảng trống
        cursor.execute("SELECT COUNT(*) FROM discount_codes")
        if cursor.fetchone()[0] == 0:
            cursor.executemany("INSERT INTO discount_codes (code, discount_rate) VALUES (%s, %s)", [
                ('SALE50', 0.50), ('FREE100', 1.00), ('ATTT20', 0.20), ('TET2026', 0.30)
            ])
        db.commit()
        cursor.close()
        db.close()
    except Exception as e:
        print("Lỗi khởi tạo Database:", e)

init_db()

if __name__ == '__main__':
    app.run(debug=True, port=5000)