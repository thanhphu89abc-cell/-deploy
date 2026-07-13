<?php
require_once dirname(__DIR__) . '/vendor/autoload.php';

require_once dirname(__DIR__) . '/db_connect.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

header('Content-Type: application/json; charset=utf-8');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$pathInfo = $_SERVER['PATH_INFO'] ?? '';
if ($pathInfo === '' || $pathInfo === null) {
    $requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $scriptBase = '/' . basename($_SERVER['SCRIPT_NAME'] ?? 'student_api.php');
    $scriptPos = stripos($requestUri, $scriptBase);
    if ($scriptPos !== false) {
        $pathInfo = substr($requestUri, $scriptPos + strlen($scriptBase));
    }
}
if ($pathInfo === '' || $pathInfo === false) {
    $pathInfo = '/';
}
$method = $_SERVER['REQUEST_METHOD'];

$input = json_decode(file_get_contents('php://input'), true) ?? [];

function jsonResponse($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit();
}
function isVercelRuntime() {
    return !empty($_ENV['VERCEL']) || getenv('VERCEL') !== false;
}

function columnExists($conn, $table, $column) {
    $safeTable = $conn->real_escape_string($table);
    $safeColumn = $conn->real_escape_string($column);
    $result = $conn->query("SHOW COLUMNS FROM `{$safeTable}` LIKE '{$safeColumn}'");
    return $result && $result->num_rows > 0;
}

function addColumnIfMissing($conn, $table, $column, $definition) {
    if (!columnExists($conn, $table, $column)) {
        $conn->query("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
    }
}

function bindDynamicParams($stmt, $types, &$params) {
    $refs = [$types];
    foreach ($params as $key => $value) {
        $refs[] = &$params[$key];
    }
    call_user_func_array([$stmt, 'bind_param'], $refs);
}
if ($pathInfo === '/verify-otp' && $method === 'POST') {
    $email = $input['email'] ?? '';
    $otp = $input['otp'] ?? '';
    $stmt = $conn->prepare("SELECT * FROM otp_codes WHERE email = ? ORDER BY id DESC LIMIT 1");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $record = $stmt->get_result()->fetch_assoc();
    
    if (!$record) jsonResponse(["message" => "Không tìm thấy yêu cầu cấp lại mật khẩu."], 400);
    if ($record['otp'] !== $otp) jsonResponse(["message" => "Mã xác nhận không đúng."], 400);
    if (strtotime($record['expires_at']) < time()) jsonResponse(["message" => "Mã xác nhận đã hết hạn."], 400);
    
    $secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
    if (empty($secret_key)) jsonResponse(["message" => "Lỗi hệ thống: JWT Secret chưa được cấu hình."], 500);

    $reset_token = JWT::encode(['email' => $email, 'action' => 'reset_password', 'exp' => time() + 900], $secret_key, 'HS256');
    jsonResponse(["message" => "Xác thực OTP thành công.", "token" => $reset_token]);

} elseif ($pathInfo === '/reset-password' && $method === 'POST') {
    $email = $input['email'] ?? '';
    $new_password = $input['newPassword'] ?? '';
    $resetToken = $input['token'] ?? '';
    $secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
    if (empty($secret_key)) jsonResponse(["message" => "Lỗi hệ thống: JWT Secret chưa được cấu hình."], 500);
    
    try {
        $payload = JWT::decode($resetToken, new Key($secret_key, 'HS256'));
        if ($payload->action !== 'reset_password' || $payload->email !== $email) {
            jsonResponse(["message" => "Phiên làm việc không hợp lệ."], 403);
        }
        $hashed = password_hash($new_password, PASSWORD_DEFAULT);
        $stmt = $conn->prepare("UPDATE users SET password_hash = ? WHERE email = ?");
        $stmt->bind_param("ss", $hashed, $email);
        $stmt->execute();
        $stmt_del = $conn->prepare("DELETE FROM otp_codes WHERE email = ?");
        $stmt_del->bind_param("s", $email);
        $stmt_del->execute();
        jsonResponse(["message" => "Đổi mật khẩu thành công!"]);
    } catch (Exception $e) {
        jsonResponse(["message" => "Thời gian đổi mật khẩu đã hết hạn."], 400);
    }
}

if ($pathInfo === '/verify-certificate' && $method === 'POST') {
    $cert_code = strtoupper(trim($input['code'] ?? ''));
    if (empty($cert_code)) jsonResponse(["message" => "Vui lòng nhập mã chứng chỉ!"], 400);
    if (preg_match('/^CERT-SEC-(\d+)-(.+)$/', $cert_code, $matches)) {
        $u_id = intval($matches[1]);
        $c_id = $matches[2];

        $stmt_u = $conn->prepare("SELECT fullname FROM users WHERE id = ?");
        $stmt_u->bind_param("i", $u_id);
        $stmt_u->execute();
        $user_res = $stmt_u->get_result()->fetch_assoc();
        $stmt_u->close();

        $stmt_c = $conn->prepare("SELECT title FROM courses WHERE id = ?");
        $stmt_c->bind_param("s", $c_id);
        $stmt_c->execute();
        $course_res = $stmt_c->get_result()->fetch_assoc();
        $stmt_c->close();

        if ($user_res && $course_res) {
            $stmt_total = $conn->prepare("SELECT COUNT(l.id) as total FROM lessons l JOIN course_weeks cw ON l.week_id = cw.id WHERE cw.course_id = ?");
            $stmt_total->bind_param("s", $c_id);
            $stmt_total->execute();
            $total_lessons = $stmt_total->get_result()->fetch_assoc()['total'] ?? 0;
            $stmt_total->close();

            $stmt_completed = $conn->prepare("SELECT COUNT(up.lesson_id) as completed FROM user_progress up JOIN lessons l ON up.lesson_id = l.id JOIN course_weeks cw ON l.week_id = cw.id WHERE cw.course_id = ? AND up.user_id = ?");
            $stmt_completed->bind_param("si", $c_id, $u_id);
            $stmt_completed->execute();
            $completed_lessons = $stmt_completed->get_result()->fetch_assoc()['completed'] ?? 0;
            $stmt_completed->close();

            if ($total_lessons > 0 && $total_lessons == $completed_lessons) {
                jsonResponse(["valid" => true, "student_name" => $user_res['fullname'], "course_name" => $course_res['title'], "message" => "Chứng chỉ hợp lệ!"]);
            }
        }
    }
    jsonResponse(["valid" => false, "message" => "Mã chứng chỉ không tồn tại hoặc học viên chưa hoàn thành khóa học!"], 404);
}

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!$authHeader && function_exists('apache_request_headers')) {
    $authHeader = apache_request_headers()['Authorization'] ?? '';
}
$token = '';
if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
    $token = $matches[1];
} elseif (isset($_GET['token'])) {
    $token = $_GET['token'];
}

if (empty($token)) {
    jsonResponse(["message" => "Vui lòng đăng nhập!"], 401);
}

$secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
if (empty($secret_key)) jsonResponse(["message" => "Lỗi hệ thống: JWT Secret chưa được cấu hình."], 500);

try {
    $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;
    $user_fullname = $decoded->fullname ?? "Học viên";
} catch (Exception $e) {
    jsonResponse(["message" => "Token không hợp lệ hoặc đã hết hạn!"], 401);
}

if ($pathInfo === '/courses' && $method === 'GET') {
    $courses_res = $conn->query("SELECT id, title, original_price, price, badge, color, icon FROM courses");
    if (!$courses_res) {
        jsonResponse(["message" => "Lỗi CSDL (courses): " . $conn->error], 500);
    }
    
    $courses = [];
    $course_map = [];
    while ($c = $courses_res->fetch_assoc()) {
        $c['weeks'] = [];
        $courses[] = $c;
        $course_map[$c['id']] = &$courses[count($courses) - 1];
    }
    $course_ids = array_keys($course_map);
    if (empty($course_ids)) {
        jsonResponse(["courses" => []]);
    }

    // [FIX 1] Thay thế fetch_all bằng vòng lặp while an toàn tuyệt đối
    $completed_lessons = [];
    $progress_stmt = $conn->prepare("SELECT lesson_id FROM user_progress WHERE user_id = ?");
    if ($progress_stmt) {
        $progress_stmt->bind_param("i", $user_id);
        $progress_stmt->execute();
        $res_prog = $progress_stmt->get_result();
        if ($res_prog) {
            while ($row = $res_prog->fetch_assoc()) {
                $completed_lessons[$row['lesson_id']] = true;
            }
        }
        $progress_stmt->close();
    }

    // [FIX 2] Xử lý truy vấn IN an toàn, không cần dùng bind_param phức tạp
    $safe_course_ids = array_map(function($id) use ($conn) {
        return "'" . $conn->real_escape_string($id) . "'";
    }, $course_ids);
    $in_clause_courses = implode(',', $safe_course_ids);

    $weeks_res = $conn->query("SELECT id, course_id, week_number, title FROM course_weeks WHERE course_id IN ($in_clause_courses) ORDER BY course_id, week_number");
    
    $week_map = [];
    if ($weeks_res) {
        while ($w = $weeks_res->fetch_assoc()) {
            $w['items'] = [];
            $week_map[$w['id']] = $w;
        }
    }
    $week_ids = array_keys($week_map);

    if (!empty($week_ids)) {
        $safe_week_ids = array_map(function($id) use ($conn) {
            return "'" . $conn->real_escape_string($id) . "'";
        }, $week_ids);
        $in_clause_weeks = implode(',', $safe_week_ids);
        
        $lessons_res = $conn->query("SELECT id, week_id, type, title, duration, video_url as videoSrc, description, quiz_question, quiz_option_a, quiz_option_b, quiz_correct_answer FROM lessons WHERE week_id IN ($in_clause_weeks) ORDER BY week_id, id");
        
        if ($lessons_res) {
            while ($lesson = $lessons_res->fetch_assoc()) {
                $lesson['completed'] = isset($completed_lessons[$lesson['id']]);
                $lesson['quiz'] = !empty($lesson['quiz_question']) ? [
                    "question" => $lesson['quiz_question'], 
                    "options" => [
                        ["v" => "a", "t" => $lesson['quiz_option_a']], 
                        ["v" => "b", "t" => $lesson['quiz_option_b']]
                    ], 
                    "correct" => $lesson['quiz_correct_answer']
                ] : null;
                
                if (isset($week_map[$lesson['week_id']])) {
                    $week_map[$lesson['week_id']]['items'][] = $lesson;
                }
            }
        }
    }
    foreach ($week_map as $week) {
        if (isset($course_map[$week['course_id']])) {
            $course_map[$week['course_id']]['weeks'][] = $week;
        }
    }
    jsonResponse(["courses" => $courses]);
}
 elseif ($pathInfo === '/checkout' && $method === 'POST') {
    $course_id = $input['course_id'] ?? '';
    if (!$course_id) jsonResponse(["message" => "Thiếu mã khóa học!"], 400);

    $stmt = $conn->prepare("SELECT price FROM courses WHERE id = ?");
    $stmt->bind_param("s", $course_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $course = $res->fetch_assoc();
    $stmt->close();

    if (!$course) jsonResponse(["message" => "Khóa học không tồn tại!"], 404);

    $price_val = intval($course['price']);
    
    $stmt_check = $conn->prepare("SELECT id, current_step FROM orders WHERE user_id = ? AND course_name = ?");
    $stmt_check->bind_param("is", $user_id, $course_id);
    $stmt_check->execute();
    $stmt_check->bind_result($existing_id, $existing_step);
    if ($stmt_check->fetch()) {
        $order_id = $existing_id;
        $stmt_check->close();
        if ($existing_step == 4) {
            $stmt_upd = $conn->prepare("UPDATE orders SET current_step = 1 WHERE id = ?");
            $stmt_upd->bind_param("s", $order_id);
            $stmt_upd->execute();
        }
    } else {
        $stmt_check->close();
        $stmt_ins = $conn->prepare("INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (?, ?, ?, 1, NOW())");
        $stmt_ins->bind_param("isi", $user_id, $course_id, $price_val);
        $stmt_ins->execute();
        $order_id = $conn->insert_id;
        $stmt_ins->close();
    }

    $memo = "ATTT " . $order_id;
    $account_name = "HOC VIEN COURSERA ATTT";
    $qr_url = "https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={$price_val}&addInfo=" . urlencode($memo) . "&accountName=" . urlencode($account_name);

    jsonResponse(["status" => "PENDING", "price" => $price_val, "memo" => $memo, "qr_url" => $qr_url, "order_id" => $order_id]);

} elseif ($pathInfo === '/apply-discount' && $method === 'POST') {
    $order_id = $input['order_id'] ?? '';
    $code = strtoupper(trim($input['code'] ?? ''));

    if (!$order_id || !$code) jsonResponse(["message" => "Thiếu thông tin mã giảm giá hoặc đơn hàng!"], 400);

    addColumnIfMissing($conn, 'discount_codes', 'starts_at', 'DATETIME NULL AFTER discount_rate');
    addColumnIfMissing($conn, 'discount_codes', 'expires_at', 'DATETIME NULL AFTER starts_at');

    $stmt = $conn->prepare("SELECT discount_rate, expires_at, starts_at FROM discount_codes WHERE code = ? AND is_active = 1");
    $stmt->bind_param("s", $code);
    $stmt->execute();
    $discount_row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$discount_row) {
        jsonResponse(["message" => "Mã giảm giá không hợp lệ hoặc đã bị khóa!"], 400);
    }

    if (!empty($discount_row['starts_at']) && strtotime($discount_row['starts_at']) > time()) {
        jsonResponse(["message" => "Mã giảm giá này chưa đến thời gian sử dụng!"], 400);
    }
    if (!empty($discount_row['expires_at']) && strtotime($discount_row['expires_at']) < time()) {
        jsonResponse(["message" => "Mã giảm giá này đã hết hạn sử dụng!"], 400);
    }

    $discount_rate = floatval($discount_row['discount_rate']);

    $is_cart = false;
    $order_ids = [];
    if (strpos($order_id, 'CART_') === 0) {
        $is_cart = true;
        $ids_str = str_replace("CART_", "", $order_id);
        $order_ids = array_filter(explode("_", $ids_str));
    } else {
        $order_ids = [$order_id];
    }

    $total_new_price = 0;
    $total_original_price = 0;
    $has_valid_order = false;

    foreach ($order_ids as $oid) {
        $oid_int = intval($oid);
        
        $stmt = $conn->prepare("SELECT course_name FROM orders WHERE id = ? AND user_id = ?");
        if ($stmt) {
            $stmt->bind_param("ii", $oid_int, $user_id);
            $stmt->execute();
            $order_row = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            if ($order_row) {
                $course_name = $order_row['course_name'];
                
                $stmt_c = $conn->prepare("SELECT price as original_price FROM courses WHERE id = ?");
                if ($stmt_c) {
                    $stmt_c->bind_param("s", $course_name);
                    $stmt_c->execute();
                    $course_row = $stmt_c->get_result()->fetch_assoc();
                    $stmt_c->close();

                    if ($course_row) {
                        $has_valid_order = true;
                        $original_price = intval($course_row['original_price']);
                        $new_price = intval($original_price * (1 - $discount_rate));

                        $stmt_disc = $conn->prepare("UPDATE orders SET price = ? WHERE id = ?");
                        if ($stmt_disc) {
                            $stmt_disc->bind_param("ii", $new_price, $oid_int);
                            $stmt_disc->execute();
                            $stmt_disc->close();
                        }

                        $total_original_price += $original_price;
                        $total_new_price += $new_price;
                    }
                }
            }
        }
    }

    if (!$has_valid_order) jsonResponse(["message" => "Đơn hàng không hợp lệ!"], 404);

    $memo = "ATTT " . ($is_cart ? "CART" . $user_id : $order_id);
    $account_name = "HOC VIEN COURSERA ATTT";
    $qr_url = "https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={$total_new_price}&addInfo=" . urlencode($memo) . "&accountName=" . urlencode($account_name);

    jsonResponse(["message" => "Áp dụng thành công! Đã giảm " . ($discount_rate * 100) . "%", "new_price" => $total_new_price, "original_price" => $total_original_price, "qr_url" => $qr_url]);

} elseif ($pathInfo === '/progress' && $method === 'POST') {
    $lesson_id = $input['lesson_id'] ?? '';
    if (!$lesson_id) jsonResponse(["message" => "Thiếu mã bài học!"], 400);
    $stmt = $conn->prepare("INSERT IGNORE INTO user_progress (user_id, lesson_id) VALUES (?, ?)");
    $stmt->bind_param("is", $user_id, $lesson_id);
    $stmt->execute();
    jsonResponse(["message" => "Đã lưu tiến độ."]);

} elseif ($pathInfo === '/review' && $method === 'POST') {
    $course_id = $input['course_id'] ?? '';
    $rating = $input['rating'] ?? 0;
    $comment = $input['comment'] ?? '';
    if (!$course_id || !$rating) jsonResponse(["message" => "Đánh giá không hợp lệ."], 400);
    $stmt = $conn->prepare("INSERT INTO course_reviews (user_id, course_id, rating, comment) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("isis", $user_id, $course_id, $rating, $comment);
    $stmt->execute();
    jsonResponse(["message" => "Cảm ơn bạn! Đánh giá đã được ghi nhận."]);

} elseif ($pathInfo === '/change-password' && $method === 'POST') {
    $old_password = $input['oldPassword'] ?? '';
    $new_password = $input['newPassword'] ?? '';

    if (!$old_password || !$new_password) jsonResponse(["message" => "Vui lòng nhập đầy đủ thông tin!"], 400);

    $stmt = $conn->prepare("SELECT password_hash FROM users WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$user || !password_verify($old_password, $user['password_hash'])) {
        jsonResponse(["message" => "Mật khẩu cũ không chính xác!"], 400);
    }

    $new_hashed = password_hash($new_password, PASSWORD_DEFAULT);
    $stmt = $conn->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    $stmt->bind_param("si", $new_hashed, $user_id);
    $stmt->execute();
    $stmt->close();

    jsonResponse(["message" => "Thay đổi mật khẩu thành công!"]);

} elseif (preg_match('#^/certificate/([^/]+)$#', $pathInfo, $matches) && $method === 'GET') {
    $course_id = $matches[1];
    $stmt = $conn->prepare("SELECT title FROM courses WHERE id = ?");
    $stmt->bind_param("s", $course_id);
    $stmt->execute();
    $course = $stmt->get_result()->fetch_assoc();
    if (!$course) {
        http_response_code(404);
        die("Khóa học không tồn tại!");
    }
    
    $cert_id = "CERT-SEC-" . str_pad($user_id, 4, '0', STR_PAD_LEFT) . "-" . strtoupper($course_id);
    $date = date('d/m/Y');
    $title = htmlspecialchars($course['title']);
    $name = htmlspecialchars($user_fullname);
    
    header('Content-Type: text/html; charset=utf-8');
    echo <<<HTML
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Chứng chỉ - {$name}</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Source+Sans+Pro:wght@400;700;900&display=swap');
            body { margin: 0; padding: 0; background: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: 'Source Sans Pro', sans-serif; }
            .certificate-wrapper { background: white; width: 1000px; height: 700px; position: relative; padding: 40px; box-sizing: border-box; box-shadow: 0 20px 50px rgba(0,0,0,0.15); border-radius: 4px; overflow: hidden; }
            .certificate-border { position: absolute; inset: 20px; border: 2px solid #0056D2; outline: 8px solid #f0f4f8; outline-offset: -12px; pointer-events: none; }
            .certificate-content { position: relative; z-index: 10; height: 100%; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 40px 60px; box-sizing: border-box; }
            .logo { font-size: 32px; font-weight: 900; color: #0056D2; letter-spacing: -1px; margin-bottom: 30px; text-transform: lowercase; }
            .title { font-family: 'Playfair Display', serif; font-size: 54px; font-weight: 700; color: #1e293b; margin-bottom: 10px; letter-spacing: 1px; }
            .subtitle { font-size: 16px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 40px; }
            .presented-to { font-size: 18px; color: #475569; margin-bottom: 15px; font-style: italic; }
            .student-name { font-family: 'Playfair Display', serif; font-size: 48px; font-weight: 700; color: #0056D2; border-bottom: 2px solid #cbd5e1; padding-bottom: 10px; min-width: 500px; margin-bottom: 30px; }
            .course-text { font-size: 18px; color: #475569; margin-bottom: 15px; }
            .course-name { font-size: 28px; font-weight: 700; color: #1e293b; margin-bottom: 50px; line-height: 1.3; }
            .footer { width: 100%; display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto; }
            .cert-info { text-align: left; font-size: 14px; color: #64748b; }
            .cert-info strong { color: #334155; }
            .signature-block { text-align: center; }
            .signature-line { width: 200px; border-bottom: 2px solid #334155; margin-bottom: 8px; }
            .signature-title { font-size: 14px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
            .seal { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); width: 120px; height: 120px; background: radial-gradient(circle, #fbbf24 0%, #d97706 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; text-align: center; font-size: 12px; box-shadow: 0 4px 15px rgba(217, 119, 6, 0.4); border: 4px dashed rgba(255,255,255,0.5); }
            .seal-text { font-family: 'Playfair Display', serif; letter-spacing: 1px; line-height: 1.4; }
            .btn-print { position: fixed; bottom: 30px; right: 30px; background: #0056D2; color: white; padding: 15px 30px; border-radius: 50px; font-weight: bold; font-size: 16px; cursor: pointer; border: none; box-shadow: 0 10px 25px rgba(0,86,210,0.3); transition: all 0.3s; z-index: 100; }
            .btn-print:hover { transform: translateY(-2px); box-shadow: 0 15px 30px rgba(0,86,210,0.4); }
            @media print { 
                body { background: white; margin: 0; padding: 0; align-items: flex-start; justify-content: flex-start; } 
                .certificate-wrapper { box-shadow: none; border: none; width: 100%; height: 100vh; padding: 20px; border-radius: 0; page-break-after: avoid; } 
                .btn-print { display: none; } 
                @page { size: landscape; margin: 0; }
            }
        </style>
    </head>
    <body>
        <button class="btn-print" onclick="window.print()"><svg style="width:18px;height:18px;margin-right:8px;vertical-align:middle;display:inline-block;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg> Xuất PDF / In chứng chỉ</button>
        <div class="certificate-wrapper">
            <div class="certificate-border"></div>
            <div class="certificate-content">
                <div class="logo">coursera</div>
                <div class="title">Chứng Nhận Hoàn Thành</div>
                <div class="subtitle">Advanced Information Security Program</div>
                
                <div class="presented-to">Chứng nhận này được trân trọng trao cho</div>
                <div class="student-name">{$name}</div>
                
                <div class="course-text">Để ghi nhận việc đã hoàn thành xuất sắc lộ trình đào tạo:</div>
                <div class="course-name">{$title}</div>
                
                <div class="seal">
                    <div class="seal-text">COURSERA<br>CERTIFIED<br>2026</div>
                </div>
                
                <div class="footer">
                    <div class="cert-info">
                        <p style="margin:0 0 5px 0;">Mã chứng chỉ: <strong>{$cert_id}</strong></p>
                        <p style="margin:0;">Ngày cấp: <strong>{$date}</strong></p>
                    </div>
                    <div class="signature-block">
                        <div class="signature-line"></div>
                        <div class="signature-title">Giám đốc Đào tạo</div>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    HTML;
    exit();

} elseif ($pathInfo === '/submit-flag' && $method === 'POST') {
    $lesson_id = $input['lesson_id'] ?? '';
    $flag = trim($input['flag'] ?? '');
    
    $stmt = $conn->prepare("SELECT flag FROM lessons WHERE id = ?");
    $stmt->bind_param("s", $lesson_id);
    $stmt->execute();
    $lesson = $stmt->get_result()->fetch_assoc();
    if (!$lesson || empty($lesson['flag'])) jsonResponse(["message" => "Bài học này không có cấu hình CTF Flag!"], 400);
    
    if ($flag === $lesson['flag']) {
        $stmt = $conn->prepare("INSERT IGNORE INTO user_progress (user_id, lesson_id) VALUES (?, ?)");
        $stmt->bind_param("is", $user_id, $lesson_id);
        $stmt->execute();
        jsonResponse(["success" => true, "message" => "Chính xác hoàn toàn! Tiến trình module đã được tích xanh."]);
    } else {
        jsonResponse(["success" => false, "message" => "Sai cấu trúc Flag! Chuỗi mật mã băm trích xuất không trùng khớp."]);
    }
} elseif ($pathInfo === '/terminal' && $method === 'POST') {
    if (isVercelRuntime()) {
        jsonResponse([
            "message" => "Tinh nang terminal Docker khong ho tro tren Vercel serverless. Hay tach sang mot backend rieng hoac VPS."
        ], 501);
    }

    $command = trim($input['command'] ?? '');
    if (empty($command)) jsonResponse(["output" => ""]);
    
    $safe_command = escapeshellarg($command);
    
    $docker_path = "docker";
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        if (file_exists("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe")) {
            $docker_path = '"C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"';
        }
    }

    $output = shell_exec($docker_path . " exec coursera_kali bash -c " . $safe_command . " 2>&1");
    
    if ($output === null) {
        $output = "Lỗi: Hệ thống không thể gọi lệnh Docker. Vui lòng đảm bảo Docker Desktop đang mở và máy ảo đang chạy.";
    }
    
    jsonResponse(["output" => trim($output)]);
} elseif ($pathInfo === '/mock-webhook' && $method === 'POST') {
    $order_id = $input['order_id'] ?? '';
    if (!$order_id) jsonResponse(["message" => "Thiếu mã đơn hàng!"], 400);
    
    jsonResponse(["success" => true, "message" => "Đã gửi yêu cầu xác nhận! Vui lòng chờ Admin duyệt để cấp quyền vào học."]);
} elseif ($pathInfo === '/cart-checkout' && $method === 'POST') {
    $course_ids = $input['course_ids'] ?? [];
    if (empty($course_ids)) jsonResponse(["message" => "Giỏ hàng trống!"], 400);

    $total_price = 0;
    $order_ids = [];
    
    $placeholders = implode(',', array_fill(0, count($course_ids), '?'));
    $types = str_repeat('s', count($course_ids));
    $stmt = $conn->prepare("SELECT id, title, price FROM courses WHERE id IN ($placeholders)");
    bindDynamicParams($stmt, $types, $course_ids);
    $stmt->execute();
    $res = $stmt->get_result();
    if (!$res) jsonResponse(["message" => "Lỗi Database (courses): " . $conn->error], 500);
    
    $courses = [];
    while ($row = $res->fetch_assoc()) { $courses[] = $row; }
    $stmt->close();

    if (empty($courses)) jsonResponse(["message" => "Khóa học không tồn tại!"], 404);

    foreach ($courses as $c) {
        $total_price += intval($c['price']);
        $price_val = intval($c['price']);
        
        $stmt_check = $conn->prepare("SELECT id, current_step FROM orders WHERE user_id = ? AND course_name = ?");
        if (!$stmt_check) jsonResponse(["message" => "Lỗi Database (orders): " . $conn->error], 500);
        
        $stmt_check->bind_param("is", $user_id, $c['id']);
        $stmt_check->execute();
        $res_check = $stmt_check->get_result();
        
        if ($row = $res_check->fetch_assoc()) {
            $existing_id = $row['id'];
            $order_ids[] = $existing_id;
            if ($row['current_step'] == 4) {
                $stmt_upd_cart = $conn->prepare("UPDATE orders SET current_step = 1 WHERE id = ?");
                $stmt_upd_cart->bind_param("i", $existing_id);
                $stmt_upd_cart->execute();
            }
        } else {
            $stmt_ins_cart = $conn->prepare("INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (?, ?, ?, 1, NOW())");
            $stmt_ins_cart->bind_param("isi", $user_id, $c['id'], $price_val);
            $stmt_ins_cart->execute();
            $order_ids[] = $conn->insert_id;
        }
    }

    $cart_order_id = "CART_" . implode("_", $order_ids);
    $memo = "ATTT " . $user_id . " CART";
    $account_name = "HOC VIEN COURSERA ATTT";
    $qr_url = "https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={$total_price}&addInfo=" . urlencode($memo) . "&accountName=" . urlencode($account_name);

    jsonResponse(["status" => "PENDING", "price" => $total_price, "memo" => $memo, "qr_url" => $qr_url, "order_id" => $cart_order_id]);

} elseif ($pathInfo === '/mock-webhook-cart' && $method === 'POST') {
    $order_id = $input['order_id'] ?? '';
    if (strpos($order_id, 'CART_') === 0) {
        jsonResponse(["success" => true, "message" => "Đã gửi yêu cầu xác nhận giỏ hàng! Vui lòng chờ Admin duyệt."]);
    } else {
        jsonResponse(["message" => "Mã đơn hàng không hợp lệ!"], 400);
    }
} elseif ($pathInfo === '/cancel-order' && $method === 'POST') {
    $order_id = $input['order_id'] ?? '';
    if (!$order_id) jsonResponse(["message" => "Thiếu mã đơn hàng!"], 400);
    
    $stmt = $conn->prepare("UPDATE orders SET current_step = 4 WHERE id = ? AND user_id = ? AND current_step = 1");
    if ($stmt) {
        $stmt->bind_param("ii", $order_id, $user_id);
        $stmt->execute();
        if ($stmt->affected_rows > 0) {
            jsonResponse(["success" => true, "message" => "Đã hủy đơn ghi danh thành công!"]);
        }
        $stmt->close();
    }
    jsonResponse(["message" => "Không thể hủy đơn hàng này. Có thể đơn đã được duyệt hoặc không tồn tại!"], 400);
} elseif ($pathInfo === '/chatbot' && $method === 'POST') {
    $message = trim($input['message'] ?? '');
    
    if (empty($message)) {
        jsonResponse(["reply" => "Tôi có thể giúp gì cho bạn hôm nay?"]);
    }

    $api_key = $_ENV['GEMINI_API_KEY'] ?? '';
    if (empty($api_key) || strpos($api_key, 'YOUR_') !== false) {
        jsonResponse(["reply" => "Lỗi hệ thống: CyberAI chưa được cấu hình. Vui lòng liên hệ quản trị viên."]);
        exit;
    }
    
    $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' . trim($api_key);
    
    $system_prompt = "Bạn là CyberAI, một trợ lý AI chuyên về An toàn thông tin. Hãy trả lời câu hỏi của học viên một cách ngắn gọn, thân thiện, và bằng tiếng Việt. Đừng dùng Markdown (như *, #, **), chỉ dùng dấu xuống dòng để tách đoạn.\n\nCâu hỏi: " . $message;
    
    $data = [
        "contents" => [ ["parts" => [ ["text" => $system_prompt] ] ] ],
        "generationConfig" => [ "temperature" => 0.7, "maxOutputTokens" => 800 ]
    ];
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); 
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($http_code == 200 && $response) {
        $result = json_decode($response, true);
        if (isset($result['candidates'][0]['content']['parts'][0]['text'])) {
            jsonResponse(["reply" => trim($result['candidates'][0]['content']['parts'][0]['text'])]);
        }
    }
    
    $error_msg = "Mã lỗi: $http_code";
    if ($response) {
        $res_json = json_decode($response, true);
        if (isset($res_json['error']['message'])) {
            $error_msg .= " - " . $res_json['error']['message'];
        }
    }
    jsonResponse(["reply" => "Hệ thống AI gặp sự cố ($error_msg). Bạn vui lòng kiểm tra lại cấu hình."]);
}

jsonResponse(["message" => "Endpoint không hợp lệ."], 404);
?>
