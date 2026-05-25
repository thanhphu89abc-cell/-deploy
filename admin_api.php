<?php
ini_set('display_errors', 0);
error_reporting(0);
ob_start();

register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (ob_get_level()) ob_clean();
        http_response_code(500);
        echo json_encode(["message" => "Lỗi sập PHP: " . $error['message'] . " (Dòng " . $error['line'] . ")"]);
        exit;
    }
});

require 'db_connect.php';
require_once 'vendor/autoload.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

header('Content-Type: application/json; charset=utf-8');

// Cấp phép cho các request kiểm tra (Preflight) của JS đi qua
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// 1. KIỂM TRA QUYỀN TRUY CẬP (Bảo mật bằng JWT Token)
$pathInfo = $_SERVER['PATH_INFO'] ?? '/';
$method = $_SERVER['REQUEST_METHOD'];

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!$authHeader) {
    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? ($headers['authorization'] ?? '');
    }
}

// Bỏ qua check JWT qua Header cho API Invoice (vì dùng token qua query params)
if (!(preg_match('#^/invoice/([^/]+)$#', $pathInfo) && $method === 'GET')) {
    if (empty($authHeader) || !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        if (ob_get_level()) ob_clean();
        http_response_code(401);
        die(json_encode(["message" => "Thiếu Token xác thực. Vui lòng đăng nhập lại."]));
    }
    $token = $matches[1];
} else {
    $token = $_GET['token'] ?? '';
    if (!$token) {
        if (ob_get_level()) ob_clean();
        http_response_code(401);
        die("Quyền truy cập bị từ chối.");
    }
}

$secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';

try {
    $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

    // Kiểm tra quyền Admin/Teacher
    $stmt = $conn->prepare("SELECT role FROM users WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $stmt->bind_result($user_role);
    $stmt->fetch();
    $stmt->close();

    if (!$user_role || !in_array($user_role, ['admin', 'teacher'])) {
        if (preg_match('#^/invoice/([^/]+)$#', $pathInfo)) {
            if (ob_get_level()) ob_clean();
            http_response_code(403);
            die("Bạn không có quyền truy cập.");
        }
        if (ob_get_level()) ob_clean();
        http_response_code(403);
        die(json_encode(["message" => "Bạn không có quyền truy cập vào tài nguyên này."]));
    }
} catch (Exception $e) {
    if (ob_get_level()) ob_clean();
    http_response_code(401);
    if (preg_match('#^/invoice/([^/]+)$#', $pathInfo)) {
        die("Token không hợp lệ hoặc đã hết hạn.");
    }
    die(json_encode(["message" => "Token không hợp lệ hoặc đã hết hạn."]));
}

// 2. BỘ ĐỊNH TUYẾN (ROUTER) XỬ LÝ YÊU CẦU TỪ JS
// Lấy dữ liệu Body (nếu có)
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];

function jsonResponse($data, $status = 200) {
    if (ob_get_level()) ob_clean();
    http_response_code($status);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        echo '{"message": "Lỗi PHP: Không thể định dạng dữ liệu."}';
    } else {
        echo $json;
    }
    exit();
}

// 2.1 QUẢN LÝ ĐƠN HÀNG
if ($pathInfo === '/orders' && $method === 'GET') {
    $orders = [];
    $res = $conn->query("SELECT o.id, o.course_name, o.price, o.current_step, o.created_at, u.fullname as user_fullname, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.id DESC");
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['created_at'] = date('d/m/Y H:i', strtotime($row['created_at']));
            $orders[] = $row;
        }
    }
    jsonResponse(["orders" => $orders]);
} elseif (preg_match('#^/approve-order/([^/]+)$#', $pathInfo, $matches) && $method === 'POST') {
    $order_id = $conn->real_escape_string($matches[1]);
    $res = $conn->query("UPDATE orders SET current_step = 3 WHERE id = '$order_id'");
    if (!$res) {
        // Tự động thêm cột current_step nếu DB của bạn chưa có
        if (strpos($conn->error, 'current_step') !== false) {
            $conn->query("ALTER TABLE orders ADD COLUMN current_step INT DEFAULT 1");
            $res = $conn->query("UPDATE orders SET current_step = 3 WHERE id = '$order_id'");
        }
        if (!$res) jsonResponse(["message" => "Lỗi Database: " . mb_convert_encoding($conn->error, 'UTF-8', 'auto')], 500);
    }
    jsonResponse(["success" => true, "message" => "Đã duyệt thành công đơn hàng #$order_id."]);
} elseif (preg_match('#^/cancel-order/([^/]+)$#', $pathInfo, $matches) && $method === 'POST') {
    $order_id = $conn->real_escape_string($matches[1]);
    $res = $conn->query("UPDATE orders SET current_step = 4 WHERE id = '$order_id'");
    if (!$res) {
        if (strpos($conn->error, 'current_step') !== false) {
            $conn->query("ALTER TABLE orders ADD COLUMN current_step INT DEFAULT 1");
            $res = $conn->query("UPDATE orders SET current_step = 4 WHERE id = '$order_id'");
        }
        if (!$res) jsonResponse(["message" => "Lỗi Database: " . mb_convert_encoding($conn->error, 'UTF-8', 'auto')], 500);
    }
    jsonResponse(["success" => true, "message" => "Đã hủy đơn hàng #$order_id."]);
} elseif ($pathInfo === '/orders/clear-cancelled' && $method === 'DELETE') {
    $res = $conn->query("DELETE FROM orders WHERE current_step = 4");
    if (!$res) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    jsonResponse(["message" => "Đã dọn dẹp toàn bộ đơn hàng bị hủy."]);
} elseif (preg_match('#^/orders/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $order_id = $conn->real_escape_string($matches[1]);
    $res = $conn->query("DELETE FROM orders WHERE id = '$order_id'");
    if (!$res) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    jsonResponse(["message" => "Xóa đơn hàng thành công."]);

// 2.2 QUẢN LÝ HỌC VIÊN
} elseif ($pathInfo === '/users' && $method === 'GET') {
    $users = [];
    $res = $conn->query("SELECT id, fullname, email, role, created_at FROM users ORDER BY id DESC");
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['created_at'] = isset($row['created_at']) ? date('d/m/Y', strtotime($row['created_at'])) : '---';
            $users[] = $row;
        }
    }
    jsonResponse(["users" => $users]);
} elseif ($pathInfo === '/users' && $method === 'POST') {
    $fullname = $input['fullname'] ?? ''; $email = $input['email'] ?? ''; $role = $input['role'] ?? 'student'; $password = $input['password'] ?? '123456';
    
    $stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    if ($stmt->fetch()) {
        $stmt->close();
        jsonResponse(["message" => "Email này đã được sử dụng!"], 409);
    }
    $stmt->close();
    
    $hashed = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $conn->prepare("INSERT INTO users (fullname, email, password_hash, role) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("ssss", $fullname, $email, $hashed, $role);
    $stmt->execute();
    jsonResponse(["message" => "Thêm người dùng thành công"], 201);
} elseif (preg_match('#^/users/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $uid = $matches[1];
    $fullname = $input['fullname'] ?? '';
    $email = $input['email'] ?? '';
    $password = $input['password'] ?? '';
    $role = $input['role'] ?? 'student';

    if ($password) {
        $hashed = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $conn->prepare("UPDATE users SET fullname = ?, email = ?, role = ?, password_hash = ? WHERE id = ?");
        $stmt->bind_param("sssss", $fullname, $email, $role, $hashed, $uid);
    } else {
        $stmt = $conn->prepare("UPDATE users SET fullname = ?, email = ?, role = ? WHERE id = ?");
        $stmt->bind_param("ssss", $fullname, $email, $role, $uid);
    }
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật thông tin người dùng thành công."]);
} elseif (preg_match('#^/users/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $uid = $conn->real_escape_string($matches[1]);
    $conn->query("DELETE FROM users WHERE id = '$uid'");
    jsonResponse(["message" => "Xóa người dùng thành công."]);

// 2.3 DOANH THU THỐNG KÊ & HÓA ĐƠN
} elseif ($pathInfo === '/revenue' && $method === 'GET') {
    $revenue = [];
    $res = $conn->query("SELECT DATE(created_at) as date, SUM(price) as total_revenue FROM orders WHERE current_step = 3 GROUP BY DATE(created_at) ORDER BY date ASC LIMIT 30");
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['date'] = date('d/m/Y', strtotime($row['date']));
            $revenue[] = $row;
        }
    }
    jsonResponse(["revenue" => $revenue]);
} elseif (preg_match('#^/invoice/([^/]+)$#', $pathInfo, $matches) && $method === 'GET') {
    $order_id = $matches[1];
    $stmt = $conn->prepare("SELECT o.id, o.course_name, o.price, o.current_step, o.created_at, u.fullname as user_fullname, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?");
    $stmt->bind_param("s", $order_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $order = $result->fetch_assoc();
    $stmt->close();
    
    if (!$order) {
        if (ob_get_level()) ob_clean();
        http_response_code(404);
        die("Không tìm thấy đơn hàng.");
    }
    
    $status_str = $order['current_step'] == 3 ? "Hoàn thành (Đã thanh toán)" : "Chờ duyệt (Chưa thanh toán)";
    $created_date = date('d/m/Y H:i', strtotime($order['created_at']));
    $status_color = $order['current_step'] == 3 ? "#28a745" : "#ffc107";
    $price_formatted = number_format($order['price'], 0, ',', '.');
    $course_name = str_replace(',', ', ', $order['course_name']);
    $order_id_padded = str_pad($order['id'], 5, '0', STR_PAD_LEFT);
    
    header('Content-Type: text/html; charset=utf-8');
    if (ob_get_level()) ob_clean();
    echo <<<HTML
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8"><title>Hóa đơn #{$order['id']}</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #333; background: #f4f7f6; }
            .invoice-box { max-width: 800px; margin: auto; padding: 40px; border: 1px solid #eee; box-shadow: 0 4px 12px rgba(0, 0, 0, .1); font-size: 15px; line-height: 24px; background: #fff; border-radius: 8px; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0056D2; padding-bottom: 20px; margin-bottom: 30px; }
            .title { color: #0056D2; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; }
            .details { display: flex; justify-content: space-between; margin-bottom: 40px; }
            .details div { width: 48%; }
            table { width: 100%; text-align: left; border-collapse: collapse; margin-bottom: 20px; }
            th, td { padding: 15px 10px; border-bottom: 1px solid #eaeaea; }
            th { background: #f9fbff; color: #0056D2; font-weight: bold; text-transform: uppercase; font-size: 13px; }
            .total-row { font-weight: bold; font-size: 18px; color: #0056D2; }
            .total-row td { border-bottom: none; border-top: 2px solid #0056D2; }
            .footer { text-align: center; margin-top: 50px; font-size: 13px; color: #888; border-top: 1px solid #eee; padding-top: 20px; }
            .btn-print { display: inline-block; padding: 12px 24px; background: #0056D2; color: white; text-decoration: none; border: none; cursor: pointer; border-radius: 6px; font-weight: bold; font-size: 14px; transition: background 0.3s; }
            .btn-print:hover { background: #0043a8; }
            @media print { body { background: #fff; padding: 0; } .invoice-box { box-shadow: none; border: none; padding: 0; } .no-print { display: none !important; } }
        </style>
    </head>
    <body>
        <div class="invoice-box">
            <div class="header">
                <div class="title">coursera<span style="font-size:14px; font-weight:normal; color:#555; display:block;">Advanced Information Security</span></div>
                <div style="text-align: right;"><strong style="font-size: 18px;">HÓA ĐƠN ĐIỆN TỬ</strong><br>Mã số: <strong>INV-{$order_id_padded}</strong><br>Ngày lập: {$created_date}</div>
            </div>
            <div class="details">
                <div><strong style="color: #888; text-transform: uppercase; font-size: 12px;">Thông tin khách hàng:</strong><br><strong>{$order['user_fullname']}</strong><br>{$order['user_email']}</div>
                <div style="text-align: right;"><strong style="color: #888; text-transform: uppercase; font-size: 12px;">Trạng thái thanh toán:</strong><br><strong style="color: {$status_color};">{$status_str}</strong></div>
            </div>
            <table>
                <thead><tr><th>Sản phẩm / Khóa học ghi danh</th><th style="text-align: right;">Thành tiền</th></tr></thead>
                <tbody>
                    <tr><td>{$course_name}</td><td style="text-align: right;">{$price_formatted} đ</td></tr>
                    <tr class="total-row"><td style="text-align: right;">TỔNG CỘNG:</td><td style="text-align: right;">{$price_formatted} đ</td></tr>
                </tbody>
            </table>
            <div class="footer">
                <p>Cảm ơn bạn đã đồng hành cùng Coursera Advanced!</p>
                <p>Đây là hóa đơn điện tử hợp lệ được xuất tự động từ hệ thống.</p>
                <div class="no-print" style="margin-top: 30px;"><button class="btn-print" onclick="window.print()">In / Lưu dưới dạng PDF</button></div>
            </div>
        </div>
    </body>
    </html>
HTML;
    exit();

// 2.4 QUẢN LÝ KHÓA HỌC
} elseif ($pathInfo === '/courses' && $method === 'GET') {
    $courses = [];
    $res = $conn->query("SELECT id, title, original_price, price, badge, color, icon FROM courses");
    if ($res) {
        while ($course = $res->fetch_assoc()) {
            $course['weeks'] = [];
            $weeks_res = $conn->query("SELECT id, week_number, title FROM course_weeks WHERE course_id = '{$course['id']}' ORDER BY week_number");
            if ($weeks_res) {
                while ($week = $weeks_res->fetch_assoc()) {
                    $week['items'] = [];
                    $lessons_res = $conn->query("SELECT * FROM lessons WHERE week_id = {$week['id']} ORDER BY id");
                    if ($lessons_res) {
                        while ($lesson = $lessons_res->fetch_assoc()) { $week['items'][] = $lesson; }
                    }
                    $course['weeks'][] = $week;
                }
            }
            $courses[] = $course;
        }
    }
    jsonResponse(["courses" => $courses]);
} elseif ($pathInfo === '/courses' && $method === 'POST') {
    $c_id = $input['id'] ?? ''; 
    $title = $input['title'] ?? ''; 
    $price = $input['price'] ?? 0;
    $badge = $input['badge'] ?? 'Mới';
    $icon = $input['icon'] ?? '';
    
    if (!$c_id || !$title) jsonResponse(["message" => "Thiếu mã định danh hoặc tiêu đề!"], 400);
    
    $stmt = $conn->prepare("INSERT INTO courses (id, title, price, original_price, badge, icon, color) VALUES (?, ?, ?, ?, ?, ?, 'from-gray-600 to-slate-800')");
    $stmt->bind_param("ssiiss", $c_id, $title, $price, $price, $badge, $icon);
    $stmt->execute();
    jsonResponse(["message" => "Thêm khóa học mới thành công."], 201);
} elseif (preg_match('#^/courses/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $c_id = $matches[1];
    $title = $input['title'] ?? '';
    $badge = $input['badge'] ?? '';
    $icon = $input['icon'] ?? '';

    $stmt = $conn->prepare("UPDATE courses SET title = ?, badge = ?, icon = ? WHERE id = ?");
    $stmt->bind_param("ssss", $title, $badge, $icon, $c_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật khóa học thành công."]);
} elseif (preg_match('#^/courses/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $c_id = $matches[1];
    
    $stmt = $conn->prepare("SELECT id FROM course_weeks WHERE course_id = ?");
    $stmt->bind_param("s", $c_id);
    $stmt->execute();
    $weeks_res = $stmt->get_result();
    while ($w = $weeks_res->fetch_assoc()) {
        $l_stmt = $conn->prepare("SELECT id FROM lessons WHERE week_id = ?");
        $l_stmt->bind_param("s", $w['id']);
        $l_stmt->execute();
        $l_res = $l_stmt->get_result();
        while ($l = $l_res->fetch_assoc()) {
            $conn->query("DELETE FROM user_progress WHERE lesson_id = '" . $l['id'] . "'");
        }
        $conn->query("DELETE FROM lessons WHERE week_id = '" . $w['id'] . "'");
    }
    $conn->query("DELETE FROM course_weeks WHERE course_id = '$c_id'");
    $conn->query("DELETE FROM courses WHERE id = '$c_id'");
    jsonResponse(["message" => "Xóa khóa học thành công."]);

} elseif (preg_match('#^/courses/([^/]+)/weeks$#', $pathInfo, $matches) && $method === 'POST') {
    $c_id = $matches[1];
    $week_number = $input['week_number'] ?? 1;
    $title = $input['title'] ?? 'Tuần mới';

    $stmt = $conn->prepare("INSERT INTO course_weeks (course_id, week_number, title) VALUES (?, ?, ?)");
    $stmt->bind_param("sis", $c_id, $week_number, $title);
    $stmt->execute();
    jsonResponse(["message" => "Thêm tuần học mới thành công."], 201);
} elseif (preg_match('#^/weeks/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $w_id = $matches[1];
    $week_number = $input['week_number'] ?? 1;
    $title = $input['title'] ?? 'Tuần mới';

    $stmt = $conn->prepare("UPDATE course_weeks SET week_number = ?, title = ? WHERE id = ?");
    $stmt->bind_param("iss", $week_number, $title, $w_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật tuần học thành công."]);
} elseif (preg_match('#^/weeks/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $w_id = $conn->real_escape_string($matches[1]);
    $stmt = $conn->prepare("SELECT id FROM lessons WHERE week_id = ?");
    $stmt->bind_param("s", $w_id);
    $stmt->execute();
    $l_res = $stmt->get_result();
    while ($l = $l_res->fetch_assoc()) {
        $conn->query("DELETE FROM user_progress WHERE lesson_id = '" . $l['id'] . "'");
    }
    $conn->query("DELETE FROM lessons WHERE week_id = '$w_id'");
    $conn->query("DELETE FROM course_weeks WHERE id = '$w_id'");
    jsonResponse(["message" => "Xóa tuần học thành công."]);
} elseif (preg_match('#^/weeks/([^/]+)/lessons$#', $pathInfo, $matches) && $method === 'POST') {
    $w_id = $matches[1];
    $title = $input['title'] ?? 'Bài học mới';
    $type = $input['type'] ?? 'video';
    $duration = 10;
    
    $stmt = $conn->prepare("INSERT INTO lessons (week_id, type, title, duration) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("sssi", $w_id, $type, $title, $duration);
    $stmt->execute();
    jsonResponse(["message" => "Thêm bài học mới thành công."], 201);
} elseif (preg_match('#^/lessons/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $l_id = $matches[1];
    $title = $input['title'] ?? null;
    $video_url = $input['video_url'] ?? null;
    $description = $input['description'] ?? null;
    $quiz_question = $input['quiz_question'] ?? null;
    $quiz_option_a = $input['quiz_option_a'] ?? null;
    $quiz_option_b = $input['quiz_option_b'] ?? null;
    $quiz_correct_answer = $input['quiz_correct_answer'] ?? null;
    $flag = $input['flag'] ?? null;

    $stmt = $conn->prepare("UPDATE lessons SET title=?, video_url=?, description=?, quiz_question=?, quiz_option_a=?, quiz_option_b=?, quiz_correct_answer=?, flag=? WHERE id=?");
    $stmt->bind_param("sssssssss", $title, $video_url, $description, $quiz_question, $quiz_option_a, $quiz_option_b, $quiz_correct_answer, $flag, $l_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật bài học thành công."]);
} elseif (preg_match('#^/lessons/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $l_id = $conn->real_escape_string($matches[1]);
    $conn->query("DELETE FROM user_progress WHERE lesson_id = '$l_id'");
    $conn->query("DELETE FROM lessons WHERE id = '$l_id'");
    jsonResponse(["message" => "Xóa bài học thành công."]);

// 2.5 QUẢN LÝ MÃ GIẢM GIÁ
} elseif ($pathInfo === '/discounts' && $method === 'GET') {
    $discounts = [];
    $res = $conn->query("SELECT * FROM discount_codes ORDER BY id DESC");
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['discount_rate'] = floatval($row['discount_rate']);
            $discounts[] = $row;
        }
    }
    jsonResponse(["discounts" => $discounts]);
} elseif ($pathInfo === '/discounts' && $method === 'POST') {
    $code = strtoupper(trim($input['code'] ?? '')); $rate = floatval($input['rate'] ?? 0) / 100.0;
    
    $stmt = $conn->prepare("SELECT id FROM discount_codes WHERE code = ?");
    $stmt->bind_param("s", $code);
    $stmt->execute();
    if ($stmt->fetch()) {
        jsonResponse(["message" => "Mã này đã tồn tại!"], 409);
    }
    $stmt->close();
    
    $stmt = $conn->prepare("INSERT INTO discount_codes (code, discount_rate) VALUES (?, ?)");
    $stmt->bind_param("sd", $code, $rate);
    $stmt->execute();
    jsonResponse(["message" => "Thêm mã giảm giá thành công."], 201);
} elseif (preg_match('#^/discounts/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $disc_id = $conn->real_escape_string($matches[1]);
    $conn->query("DELETE FROM discount_codes WHERE id = '$disc_id'");
    jsonResponse(["message" => "Xóa mã giảm giá thành công."]);
} elseif (preg_match('#^/discounts/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $disc_id = $matches[1];
    $is_active = isset($input['is_active']) ? (int)$input['is_active'] : 1;
    $stmt = $conn->prepare("UPDATE discount_codes SET is_active = ? WHERE id = ?");
    $stmt->bind_param("is", $is_active, $disc_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật trạng thái thành công."]);

// 2.6 UPLOAD ẢNH/FILE
} elseif ($pathInfo === '/upload' && $method === 'POST') {
    if (!isset($_FILES['file'])) jsonResponse(['message' => 'Không tìm thấy file.'], 400);
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) jsonResponse(['message' => 'Lỗi upload file.'], 400);
    
    $upload_dir = __DIR__ . '/uploads/';
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    
    $filename = basename($file['name']);
    $filename = preg_replace("/[^a-zA-Z0-9.-]/", "_", $filename);
    $unique_filename = uniqid() . '_' . $filename;
    
    $filepath = $upload_dir . $unique_filename;
    if (move_uploaded_file($file['tmp_name'], $filepath)) {
        $base_dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
        $file_url = "$base_dir/uploads/$unique_filename";
        jsonResponse(['message' => 'Upload thành công', 'url' => $file_url]);
    } else {
        jsonResponse(['message' => 'Lưu file thất bại.'], 500);
    }
}

jsonResponse(["message" => "API chưa được xây dựng: " . $pathInfo], 404);
?>