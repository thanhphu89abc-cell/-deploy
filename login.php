<?php
ob_start();
ini_set('display_errors', 0);
error_reporting(0);

register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (ob_get_level()) ob_clean();
        http_response_code(500);
        echo json_encode(["message" => "Lỗi hệ thống: " . $error['message'] . " (Dòng " . $error['line'] . ")"]);
        exit;
    }
});

require 'db_connect.php';
if (file_exists('vendor/autoload.php')) require_once 'vendor/autoload.php';

header('Content-Type: application/json; charset=utf-8');

$data = json_decode(file_get_contents("php://input"));

if (!is_object($data)) {
    if (ob_get_level()) ob_clean();
    http_response_code(400);
    echo json_encode(["message" => "Dữ liệu không hợp lệ!"]);
    exit();
}

// ---- XỬ LÝ ĐĂNG NHẬP GOOGLE ----
if (isset($data->google_token)) {
    $google_token = $data->google_token;
    
    // Gọi API của Google để xác thực Token (tắt kiểm tra SSL để XAMPP không bị lỗi)
    $context = stream_context_create([
        "ssl" => [
            "verify_peer" => false,
            "verify_peer_name" => false,
        ],
    ]);
    
    $response = @file_get_contents("https://oauth2.googleapis.com/tokeninfo?id_token=" . $google_token, false, $context);
    
    if (!$response) {
        if (ob_get_level()) ob_clean();
        http_response_code(400);
        echo json_encode(["message" => "Xác thực Google thất bại!"]);
        exit();
    }
    
    $g_data = json_decode($response);
    if (!isset($g_data->email)) {
        if (ob_get_level()) ob_clean();
        http_response_code(400);
        echo json_encode(["message" => "Không thể lấy thông tin email từ Google!"]);
        exit();
    }
    
    $email = $g_data->email;
    $fullname = $g_data->name ?? "Học viên Google";
    
    // Kiểm tra xem user đã tồn tại chưa
    $stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows > 0) {
        $user = $result->fetch_assoc();
    } else {
        // Tự động tạo tài khoản nếu đăng nhập lần đầu (cấp mật khẩu ngẫu nhiên siêu bảo mật)
        $hashed = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
        $role = 'student';
        $stmt_ins = $conn->prepare("INSERT INTO users (fullname, email, password_hash, role) VALUES (?, ?, ?, ?)");
        $stmt_ins->bind_param("ssss", $fullname, $email, $hashed, $role);
        $stmt_ins->execute();
        
        $user = [
            'id' => $conn->insert_id,
            'email' => $email,
            'fullname' => $fullname,
            'role' => $role
        ];
    }
    
    // Tạo JWT Token cho hệ thống của bạn
    $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
    $payload = [
        'user_id' => $user['id'],
        'email' => $user['email'],
        'fullname' => $user['fullname'],
        'exp' => time() + (24 * 60 * 60)
    ];

    $base64UrlHeader = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'])));
    $base64UrlPayload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode($payload)));
    $signature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, $secret_key, true);
    $base64UrlSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
    $jwt = $base64UrlHeader . "." . $base64UrlPayload . "." . $base64UrlSignature;

    if (ob_get_level()) ob_clean();
    http_response_code(200);
    echo json_encode([
        "message" => "Đăng nhập Google thành công!",
        "token" => $jwt,
        "user" => [
            "fullname" => $user['fullname'],
            "email" => $user['email'],
            "role" => $user['role'] ?? 'student'
        ]
    ]);
    exit();
}
// --------------------------------

if (!isset($data->email) || !isset($data->password)) {
    if (ob_get_level()) ob_clean();
    http_response_code(400);
    echo json_encode(["message" => "Vui lòng nhập email và mật khẩu!"]);
    exit();
}

$email = $data->email;
$password = $data->password;

$stmt = $conn->prepare("SELECT * FROM users WHERE email = ?");
$stmt->bind_param("s", $email);
$stmt->execute();
$result = $stmt->get_result();

if ($result->num_rows > 0) {
    $user = $result->fetch_assoc();
    
    // Tự động thêm cột vào Database nếu chưa có
    if (!array_key_exists('failed_attempts', $user)) {
        $conn->query("ALTER TABLE users ADD COLUMN failed_attempts INT DEFAULT 0");
        $conn->query("ALTER TABLE users ADD COLUMN locked_until DATETIME NULL");
        $user['failed_attempts'] = 0;
        $user['locked_until'] = null;
    }

    // Kiểm tra xem tài khoản có đang bị khóa không
    if ($user['locked_until'] && strtotime($user['locked_until']) > time()) {
        if (ob_get_level()) ob_clean();
        http_response_code(403);
        $remaining_mins = ceil((strtotime($user['locked_until']) - time()) / 60);
        echo json_encode(["message" => "Tài khoản đã bị khóa tạm thời do nhập sai nhiều lần. Vui lòng thử lại sau $remaining_mins phút nữa."]);
        exit();
    }

    // Xác thực mật khẩu
    if (password_verify($password, $user['password_hash'])) {
        // Reset số lần nhập sai khi đăng nhập thành công
        if ($user['failed_attempts'] > 0 || $user['locked_until']) {
            $conn->query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = " . $user['id']);
        }

        $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
        
        $payload = [
            'user_id' => $user['id'],
            'email' => $user['email'],
            'fullname' => $user['fullname'],
            'exp' => time() + (24 * 60 * 60) // Token hết hạn sau 24 giờ
        ];

        // Tạo JWT thuần bằng PHP không cần thư viện ngoài
        $base64UrlHeader = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'])));
        $base64UrlPayload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode($payload)));
        $signature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, $secret_key, true);
        $base64UrlSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
        $jwt = $base64UrlHeader . "." . $base64UrlPayload . "." . $base64UrlSignature;

        if (ob_get_level()) ob_clean();
        http_response_code(200);
        echo json_encode([
            "message" => "Đăng nhập thành công!",
            "token" => $jwt,
            "user" => [
                "fullname" => $user['fullname'],
                "email" => $user['email'],
                "role" => $user['role']
            ]
        ]);
    } else {
        // Xử lý khi nhập sai mật khẩu
        $attempts = $user['failed_attempts'] + 1;
        if ($attempts >= 5) {
            // Khóa tài khoản 15 phút
            $conn->query("UPDATE users SET failed_attempts = $attempts, locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id = " . $user['id']);
            if (ob_get_level()) ob_clean();
            http_response_code(403);
            echo json_encode(["message" => "Bạn đã nhập sai mật khẩu 5 lần. Tài khoản bị khóa tạm thời trong 15 phút."]);
        } else {
            $conn->query("UPDATE users SET failed_attempts = $attempts WHERE id = " . $user['id']);
            $remain = 5 - $attempts;
            if (ob_get_level()) ob_clean();
            http_response_code(401);
            echo json_encode(["message" => "Mật khẩu không đúng! Bạn còn $remain lần thử trước khi bị khóa."]);
        }
    }
} else {
    if (ob_get_level()) ob_clean();
    http_response_code(401);
    echo json_encode(["message" => "Email hoặc mật khẩu không đúng!"]);
}

$stmt->close();
$conn->close();
?>