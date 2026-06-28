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

require_once dirname(__DIR__) . '/db_connect.php';
// Sử dụng thư viện JWT đã có
use Firebase\JWT\JWT;

header('Content-Type: application/json; charset=utf-8');

function jsonResponse($data, $status = 200) {
    if (ob_get_level()) ob_clean();
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit();
}

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
        
        if (array_key_exists('is_blocked', $user) && $user['is_blocked'] == 1) {
            if (ob_get_level()) ob_clean();
            http_response_code(403);
            echo json_encode(["message" => "Tài khoản của bạn đã bị khóa do vi phạm chính sách! Vui lòng liên hệ Admin."]);
            exit();
        }
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
    $secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
    if (empty($secret_key)) jsonResponse(["message" => "Lỗi hệ thống: JWT Secret chưa được cấu hình."], 500);

    $payload = [
        'user_id' => $user['id'],
        'email' => $user['email'],
        'fullname' => $user['fullname'],
        'exp' => time() + (24 * 60 * 60)
    ];

    $jwt = JWT::encode($payload, $secret_key, 'HS256');
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
    
    if (isset($user['is_blocked']) && $user['is_blocked'] == 1) {
        if (ob_get_level()) ob_clean();
        http_response_code(403);
        echo json_encode(["message" => "Tài khoản của bạn đã bị khóa do vi phạm chính sách! Vui lòng liên hệ Admin."]);
        exit();
    }

    // Kiểm tra xem tài khoản có đang bị khóa không
    if (isset($user['locked_until']) && $user['locked_until'] && strtotime($user['locked_until']) > time()) {
        if (ob_get_level()) ob_clean();
        http_response_code(403);
        $remaining_mins = ceil((strtotime($user['locked_until']) - time()) / 60);
        echo json_encode(["message" => "Tài khoản đã bị khóa tạm thời do nhập sai nhiều lần. Vui lòng thử lại sau $remaining_mins phút nữa."]);
        exit();
    }

    // Xác thực mật khẩu
    if (password_verify($password, $user['password_hash'])) {
        // Reset số lần nhập sai khi đăng nhập thành công (nếu các cột đó tồn tại)
        if ($user['failed_attempts'] > 0 || $user['locked_until']) {
            $conn->query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = " . $user['id']);
        }

        $secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
        if (empty($secret_key)) jsonResponse(["message" => "Lỗi hệ thống: JWT Secret chưa được cấu hình."], 500);
        
        $payload = [
            'user_id' => $user['id'],
            'email' => $user['email'],
            'fullname' => $user['fullname'],
            'exp' => time() + (24 * 60 * 60) // Token hết hạn sau 24 giờ
        ];

        $jwt = JWT::encode($payload, $secret_key, 'HS256');
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
        $attempts = (isset($user['failed_attempts']) ? $user['failed_attempts'] : 0) + 1;
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