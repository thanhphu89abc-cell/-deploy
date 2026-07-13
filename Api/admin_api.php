<?php
require_once dirname(__DIR__) . '/vendor/autoload.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

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

require_once dirname(__DIR__) . '/db_connect.php';

header('Content-Type: application/json; charset=utf-8');

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$pathInfo = $_SERVER['PATH_INFO'] ?? '';
if ($pathInfo === '' || $pathInfo === null) {
    $requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $scriptBase = '/' . basename($_SERVER['SCRIPT_NAME'] ?? 'admin_api.php');
    $scriptPos = stripos($requestUri, $scriptBase);
    if ($scriptPos !== false) {
        $pathInfo = substr($requestUri, $scriptPos + strlen($scriptBase));
    }
}
if ($pathInfo === '' || $pathInfo === false) {
    $pathInfo = '/';
}
$method = $_SERVER['REQUEST_METHOD'];

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!$authHeader) {
    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? ($headers['authorization'] ?? '');
    }
}

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

$secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
if (empty($secret_key)) die(json_encode(["message" => "Lỗi hệ thống: JWT Secret chưa được cấu hình."]));

try {
    $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

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

    // [FIX] Phân quyền chi tiết cho Giảng viên (teacher)
    if ($user_role === 'teacher') {
        $admin_only_endpoints = [
            '/dashboard-summary',
            '/revenue',
            '#^/orders#',
            '#^/approve-order/([^/]+)$#',
            '#^/cancel-order/([^/]+)$#',
            '#^/users#',
            '#^/invoice/([^/]+)$#',
            '#^/discounts#',
        ];

        $is_admin_endpoint = false;
        foreach ($admin_only_endpoints as $pattern) {
            if (substr($pattern, 0, 1) === '#' ? preg_match($pattern, $pathInfo) : $pathInfo === $pattern) {
                $is_admin_endpoint = true;
                break;
            }
        }

        if ($is_admin_endpoint) {
            jsonResponse(["message" => "Giảng viên không có quyền truy cập vào chức năng này."], 403);
        }
    }
} catch (Exception $e) {
    if (ob_get_level()) ob_clean();
    http_response_code(401);
    if (preg_match('#^/invoice/([^/]+)$#', $pathInfo)) {
        die("Token không hợp lệ hoặc đã hết hạn.");
    }
    die(json_encode(["message" => "Token không hợp lệ hoặc đã hết hạn."]));
}

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
function isVercelRuntime() {
    return !empty($_ENV['VERCEL']) || getenv('VERCEL') !== false;
}

function getPublicUploadDir() {
    return dirname(__DIR__) . '/uploads/';
}

function getPublicUploadUrl($filename) {
    return '/uploads/' . $filename;
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
if ($pathInfo === '/dashboard-summary' && $method === 'GET') {
    $summary = [];
    $thirty_days_ago = date('Y-m-d H:i:s', strtotime('-90 days'));

    $stmt_stats = $conn->prepare("SELECT SUM(price) as total_revenue, COUNT(id) as total_orders FROM orders WHERE current_step = 3 AND created_at >= ?");
    $stmt_stats->bind_param("s", $thirty_days_ago);
    $stmt_stats->execute();
    $stats = $stmt_stats->get_result()->fetch_assoc();
    $summary['stats']['revenue'] = $stats['total_revenue'] ?? 0;
    $summary['stats']['orders'] = $stats['total_orders'] ?? 0;
    $stmt_stats->close();

    $stmt_users = $conn->prepare("SELECT COUNT(id) as total_users FROM users WHERE role = 'student' AND is_blocked = 0 AND created_at >= ?");
    $stmt_users->bind_param("s", $thirty_days_ago);
    $stmt_users->execute();
    $user_stats = $stmt_users->get_result()->fetch_assoc();
    $summary['stats']['users'] = $user_stats['total_users'] ?? 0;
    $stmt_users->close();

    $revenue_chart = [];
    $res_chart = $conn->query("SELECT DATE(created_at) as date, SUM(price) as total_revenue FROM orders WHERE current_step = 3 AND created_at >= '{$thirty_days_ago}' GROUP BY DATE(created_at) ORDER BY date ASC");
    if ($res_chart) {
        while ($row = $res_chart->fetch_assoc()) {
            $row['date'] = date('d/m', strtotime($row['date']));
            $revenue_chart[] = $row;
        }
    }
    $summary['revenue_chart'] = $revenue_chart;

    $recent_orders = [];
    $res_orders = $conn->query("SELECT o.id, o.course_name, o.price, o.current_step, u.fullname as user_fullname FROM orders o LEFT JOIN users u ON o.user_id = u.id ORDER BY o.id DESC LIMIT 5");
    if ($res_orders) {
        while ($row = $res_orders->fetch_assoc()) {
            $recent_orders[] = $row;
        }
    }
    $summary['recent_orders'] = $recent_orders;

    $new_users = [];
    $res_users = $conn->query("SELECT fullname, email, created_at FROM users WHERE role = 'student' ORDER BY id DESC LIMIT 5");
    if ($res_users) {
        while ($row = $res_users->fetch_assoc()) {
            $new_users[] = $row;
        }
    }
    $summary['new_users'] = $new_users;

    jsonResponse($summary);
}
if ($pathInfo === '/orders' && $method === 'GET') {
    addColumnIfMissing($conn, 'orders', 'is_deleted', 'TINYINT(1) DEFAULT 0');
    $orders = [];
    $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
    $offset = ($page - 1) * $limit;

    $search = $_GET['search'] ?? '';
    $status = $_GET['status'] ?? 'all';
    $date_from = $_GET['date_from'] ?? '';
    $date_to = $_GET['date_to'] ?? '';
    $show_deleted = isset($_GET['show_deleted']) && $_GET['show_deleted'] === 'true';

    $where_clauses = [];

    if (!$show_deleted) {
        $where_clauses[] = "o.is_deleted = 0";
    }

    if (!empty($search)) {
        $safe_search = "'%" . $conn->real_escape_string($search) . "%'";
        $where_clauses[] = "(u.fullname LIKE $safe_search OR u.email LIKE $safe_search OR o.id LIKE $safe_search)";
    }

    if ($status !== 'all') {
        $step_map = ['pending' => 1, 'completed' => 3, 'cancelled' => 4];
        if (array_key_exists($status, $step_map)) {
            $where_clauses[] = "o.current_step = " . $step_map[$status];
        }
    }

    if (!empty($date_from)) {
        $safe_date_from = "'" . $conn->real_escape_string($date_from) . " 00:00:00'";
        $where_clauses[] = "o.created_at >= $safe_date_from";
    }
    if (!empty($date_to)) {
        $safe_date_to = "'" . $conn->real_escape_string($date_to) . " 23:59:59'";
        $where_clauses[] = "o.created_at <= $safe_date_to";
    }

    $where_sql = count($where_clauses) > 0 ? "WHERE " . implode(" AND ", $where_clauses) : "";

    $total_res = $conn->query("SELECT COUNT(o.id) as total FROM orders o LEFT JOIN users u ON o.user_id = u.id $where_sql");
    if (!$total_res) jsonResponse(["message" => "Lỗi Database (total_res): " . $conn->error], 500);
    $total_records = $total_res->fetch_assoc()['total'];

    $res = $conn->query("SELECT o.id, o.course_name, o.price, o.current_step, o.created_at, u.fullname as user_fullname, u.email as user_email, o.is_deleted FROM orders o LEFT JOIN users u ON o.user_id = u.id $where_sql ORDER BY o.id DESC LIMIT $limit OFFSET $offset");
    if (!$res) jsonResponse(["message" => "Lỗi Database (res): " . $conn->error], 500);

    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['created_at'] = date('d/m/Y H:i', strtotime($row['created_at']));
            $row['is_deleted'] = (int)$row['is_deleted'];
            if (is_null($row['user_fullname'])) {
                $row['user_fullname'] = '[Người dùng đã xóa]';
                $row['user_email'] = 'N/A';
            }
            $orders[] = $row;
        }
    }
    jsonResponse(["orders" => $orders, "totalRecords" => $total_records]);
} elseif (preg_match('#^/approve-order/([^/]+)$#', $pathInfo, $matches) && $method === 'POST') {
    $order_id = $matches[1];
    $stmt = $conn->prepare("UPDATE orders SET current_step = 3 WHERE id = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("i", $order_id);
    $stmt->execute();
    $stmt->close();

    $stmt_info = $conn->prepare("SELECT o.user_id, u.email, u.fullname, c.title as course_title, o.course_name as course_id FROM orders o JOIN users u ON o.user_id = u.id JOIN courses c ON o.course_name COLLATE utf8mb4_unicode_ci = c.id WHERE o.id = ?");
    if (!$stmt_info) jsonResponse(["message" => "Lỗi Database (prepare stmt_info): " . $conn->error], 500);
    $stmt_info->bind_param("i", $order_id);
    $stmt_info->execute();
    $res_info = $stmt_info->get_result();
    if ($row = $res_info->fetch_assoc()) {
        $order_user_id = $row['user_id'];
        $course_title = $row['course_title'];
        $course_id_str = $row['course_id'];

        // [FIX] Tự động tạo bảng notifications nếu chưa tồn tại để tránh lỗi sập hệ thống
        $conn->query("CREATE TABLE IF NOT EXISTS `notifications` (
            `id` int(11) NOT NULL AUTO_INCREMENT,
            `user_id` int(11) NOT NULL,
            `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
            `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
            `course_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
            `read` tinyint(1) NOT NULL DEFAULT 0,
            `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
            PRIMARY KEY (`id`),
            KEY `user_id` (`user_id`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");

        $notif_title = "Đơn hàng được duyệt";
        $notif_message = "Lộ trình <span class=\"text-[#0056D2] dark:text-blue-400 font-bold\">{$course_title}</span> đã được duyệt. Vào học ngay!";
        $stmt_notif = $conn->prepare("INSERT INTO notifications (user_id, title, message, course_id) VALUES (?, ?, ?, ?)");
        if ($stmt_notif) {
            $stmt_notif->bind_param("isss", $order_user_id, $notif_title, $notif_message, $course_id_str);
            $stmt_notif->execute();
            $stmt_notif->close();
        }

        try {
            $smtp_user = $_ENV['SMTP_USER'] ?? null;
            $smtp_pass = $_ENV['SMTP_PASS'] ?? null;

            if (!$smtp_user || !$smtp_pass) {
                error_log("Lỗi gửi email duyệt đơn hàng: Cấu hình SMTP chưa được thiết lập trong file .env");
                jsonResponse(["success" => true, "message" => "Đã duyệt thành công đơn hàng #$order_id (Cảnh báo: không thể gửi email do thiếu cấu hình SMTP)."]);
            }
            $mail = new PHPMailer(true);
            $mail->isSMTP();
            $mail->Host       = $_ENV['SMTP_HOST'] ?? 'smtp.gmail.com';
            $mail->SMTPAuth   = true;
            $mail->Username   = $smtp_user;
            $mail->Password   = $smtp_pass;
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port       = $_ENV['SMTP_PORT'] ?? 587;
            $mail->CharSet    = 'UTF-8';
            $mail->setFrom($smtp_user, 'Coursera Advanced');
            $mail->addAddress($row['email'], $row['fullname']);
            $mail->isHTML(true);
            $mail->Subject = 'Khóa học của bạn đã được duyệt!';
            $mail->Body    = "<h3>Chào {$row['fullname']},</h3><p>Đơn đăng ký khóa học <b>{$course_title}</b> của bạn đã được Quản trị viên phê duyệt thành công.</p><p>Bạn đã có thể đăng nhập vào hệ thống và bắt đầu học ngay bây giờ!</p><br><p>Chúc bạn học tốt,<br>Coursera Advanced Team</p>";
            $mail->send();
        } catch (Exception $e) {
            error_log("Lỗi PHPMailer khi duyệt đơn hàng: " . $mail->ErrorInfo);
        }
    }
    $stmt_info->close();

    jsonResponse(["success" => true, "message" => "Đã duyệt thành công đơn hàng #$order_id."]);
} elseif (preg_match('#^/cancel-order/([^/]+)$#', $pathInfo, $matches) && $method === 'POST') {
    $order_id = $matches[1];
    $stmt = $conn->prepare("UPDATE orders SET current_step = 4 WHERE id = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("i", $order_id);
    $stmt->execute();
    $stmt->close();
    jsonResponse(["success" => true, "message" => "Đã hủy đơn hàng #$order_id."]);
} elseif ($pathInfo === '/orders/clear-cancelled' && $method === 'DELETE') {
    $res = $conn->query("DELETE FROM orders WHERE current_step = 4");
    if (!$res) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    jsonResponse(["message" => "Đã dọn dẹp toàn bộ đơn hàng bị hủy."]);
} elseif (preg_match('#^/orders/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $order_id = $matches[1];
    $stmt = $conn->prepare("UPDATE orders SET is_deleted = 1 WHERE id = ?");
    $stmt->bind_param("i", $order_id);
    if (!$stmt->execute()) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    jsonResponse(["message" => "Xóa đơn hàng thành công."]);
} elseif (preg_match('#^/orders/([^/]+)/restore$#', $pathInfo, $matches) && $method === 'POST') {
    $order_id = $matches[1];
    $stmt = $conn->prepare("UPDATE orders SET is_deleted = 0 WHERE id = ?");
    $stmt->bind_param("i", $order_id);
    if (!$stmt->execute()) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    jsonResponse(["message" => "Khôi phục đơn hàng thành công."]);

// 2.2 QUẢN LÝ HỌC VIÊN
} elseif ($pathInfo === '/users' && $method === 'GET') {
    addColumnIfMissing($conn, 'users', 'is_blocked', 'TINYINT(1) DEFAULT 0');
    $users = [];
    $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
    $offset = ($page - 1) * $limit;
    $search = $_GET['search'] ?? '';

    $where_clauses = [];
    $params = [];
    $types = "";

    if (!empty($search)) {
        $where_clauses[] = "(fullname LIKE ? OR email LIKE ?)";
        $search_param = "%{$search}%";
        array_push($params, $search_param, $search_param);
        $types .= "ss";
    }
    $where_sql = count($where_clauses) > 0 ? "WHERE " . implode(" AND ", $where_clauses) : "";

    $total_stmt = $conn->prepare("SELECT COUNT(*) as total FROM users $where_sql");
    if (!empty($types)) bindDynamicParams($total_stmt, $types, $params);
    $total_stmt->execute();
    $total_records = $total_stmt->get_result()->fetch_assoc()['total'];

    $stmt = $conn->prepare("SELECT id, fullname, email, role, created_at, is_blocked FROM users $where_sql ORDER BY id DESC LIMIT ? OFFSET ?");
    array_push($params, $limit, $offset);
    $types .= "ii";
    bindDynamicParams($stmt, $types, $params);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['created_at'] = isset($row['created_at']) ? date('d/m/Y', strtotime($row['created_at'])) : '---';
            $row['is_blocked'] = (int)$row['is_blocked'];
            $users[] = $row;
        }
    }
    jsonResponse(["users" => $users, "totalRecords" => $total_records]);
} elseif ($pathInfo === '/users' && $method === 'POST') {
    $fullname = $input['fullname'] ?? ''; $email = $input['email'] ?? ''; $role = $input['role'] ?? 'student'; $password = $input['password'] ?? '123456';
    
    $stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("s", $email);
    $stmt->execute();
    if ($stmt->fetch()) {
        $stmt->close();
        jsonResponse(["message" => "Email này đã được sử dụng!"], 409);
    }
    $stmt->close();
    
    $hashed = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $conn->prepare("INSERT INTO users (fullname, email, password_hash, role, is_blocked) VALUES (?, ?, ?, ?, 0)");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
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
        if (!$stmt) jsonResponse(["message" => "Lỗi Database (có pass): " . $conn->error], 500);
        $stmt->bind_param("ssssi", $fullname, $email, $role, $hashed, $uid);
    } else {
        $stmt = $conn->prepare("UPDATE users SET fullname = ?, email = ?, role = ? WHERE id = ?");
        if (!$stmt) jsonResponse(["message" => "Lỗi Database (ko pass): " . $conn->error], 500);
        $stmt->bind_param("sssi", $fullname, $email, $role, $uid);
    }
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật thông tin người dùng thành công."]);
} elseif (preg_match('#^/users/([^/]+)/toggle-block$#', $pathInfo, $matches) && $method === 'PUT') {
    $uid = $matches[1];
    $is_blocked = isset($input['is_blocked']) ? (int)$input['is_blocked'] : 0;
    $stmt = $conn->prepare("UPDATE users SET is_blocked = ? WHERE id = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("is", $is_blocked, $uid);
    $stmt->execute();
    jsonResponse(["message" => $is_blocked ? "Đã khóa tài khoản thành công." : "Đã mở khóa tài khoản thành công."]);
} elseif (preg_match('#^/users/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $uid = $matches[1];
    $stmt = $conn->prepare("DELETE FROM users WHERE id = ?");
    $stmt->bind_param("i", $uid);
    $stmt->execute();
    jsonResponse(["message" => "Xóa người dùng thành công."]);

} elseif ($pathInfo === '/revenue' && $method === 'GET') {
    $revenue = [];
    $thirty_days_ago = date('Y-m-d H:i:s', strtotime('-30 days'));
    $res = $conn->query("SELECT DATE(created_at) as date, SUM(price) as total_revenue FROM orders WHERE current_step = 3 AND created_at >= '{$thirty_days_ago}' GROUP BY DATE(created_at) ORDER BY date ASC");
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['date'] = date('d/m', strtotime($row['date']));
            $revenue[] = $row;
        }
    } else {
        error_log("Admin revenue query failed: " . $conn->error);
    }
    jsonResponse(["revenue" => $revenue]);
} elseif (preg_match('#^/invoice/([^/]+)$#', $pathInfo, $matches) && $method === 'GET') {
    $order_id = $matches[1];
    $stmt = $conn->prepare("SELECT o.id, o.course_name, o.price, o.current_step, o.created_at, u.fullname as user_fullname, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
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
            .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0056D2; padding-bottom: 20px; margin-bottom: 30px; }
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
                <div class="title">Coursera<span style="font-size:14px; font-weight:normal; color:#555; display:block;">Advanced Information Security</span></div>
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

} elseif ($pathInfo === '/courses' && $method === 'GET') {
    $courses = [];
    $course_map = [];
    $res = $conn->query("SELECT id, title, original_price, price, badge, color, icon FROM courses");
    if (!$res) jsonResponse(["message" => "Lỗi CSDL (courses)"], 500);
    while ($c = $res->fetch_assoc()) {
        $c['weeks'] = [];
        $courses[] = $c;
        $course_map[$c['id']] = &$courses[count($courses) - 1];
    }
    $course_ids = array_keys($course_map);

    if (!empty($course_ids)) {
        $placeholders = implode(',', array_fill(0, count($course_ids), '?'));
        $types = str_repeat('s', count($course_ids));
        
        $weeks_stmt = $conn->prepare("SELECT id, course_id, week_number, title FROM course_weeks WHERE course_id IN ($placeholders) ORDER BY course_id, week_number");
        if ($weeks_stmt) {
            bindDynamicParams($weeks_stmt, $types, $course_ids);
            $weeks_stmt->execute();
            $weeks_res = $weeks_stmt->get_result();
            $week_map = [];
            while ($w = $weeks_res->fetch_assoc()) {
                $w['items'] = [];
                $week_map[$w['id']] = $w;
            }
            $week_ids = array_keys($week_map);

            if (!empty($week_ids)) {
                $placeholders_lessons = implode(',', array_fill(0, count($week_ids), '?'));
                $types_lessons = str_repeat('i', count($week_ids));
                $lessons_stmt = $conn->prepare("SELECT * FROM lessons WHERE week_id IN ($placeholders_lessons) ORDER BY week_id, id");
                if ($lessons_stmt) {
                    bindDynamicParams($lessons_stmt, $types_lessons, $week_ids);
                    $lessons_stmt->execute();
                    $lessons_res = $lessons_stmt->get_result();
                    while ($lesson = $lessons_res->fetch_assoc()) { if (isset($week_map[$lesson['week_id']])) { $week_map[$lesson['week_id']]['items'][] = $lesson; } }
                }
            }
            foreach ($week_map as $week) { if (isset($course_map[$week['course_id']])) { $course_map[$week['course_id']]['weeks'][] = $week; } }
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
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("ssiiss", $c_id, $title, $price, $price, $badge, $icon);
    $stmt->execute();
    jsonResponse(["message" => "Thêm khóa học mới thành công."], 201);
} elseif (preg_match('#^/courses/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $c_id = $matches[1];
    $title = $input['title'] ?? '';
    $badge = $input['badge'] ?? '';
    $icon = $input['icon'] ?? '';

    $stmt = $conn->prepare("UPDATE courses SET title = ?, badge = ?, icon = ? WHERE id = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("ssss", $title, $badge, $icon, $c_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật khóa học thành công."]);
} elseif (preg_match('#^/courses/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $c_id = $matches[1];
    $stmt = $conn->prepare("DELETE FROM courses WHERE id = ?");
    $stmt->bind_param("s", $c_id);
    $stmt->execute();
    jsonResponse(["message" => "Xóa khóa học thành công."]);

} elseif (preg_match('#^/courses/([^/]+)/weeks$#', $pathInfo, $matches) && $method === 'POST') {
    $c_id = $matches[1];
    $week_number = $input['week_number'] ?? 1;
    $title = $input['title'] ?? 'Tuần mới';

    $stmt = $conn->prepare("INSERT INTO course_weeks (course_id, week_number, title) VALUES (?, ?, ?)");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("sis", $c_id, $week_number, $title);
    $stmt->execute();
    jsonResponse(["message" => "Thêm tuần học mới thành công."], 201);
} elseif (preg_match('#^/weeks/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $w_id = $matches[1];
    $week_number = $input['week_number'] ?? 1;
    $title = $input['title'] ?? 'Tuần mới';

    $stmt = $conn->prepare("UPDATE course_weeks SET week_number = ?, title = ? WHERE id = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("iss", $week_number, $title, $w_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật tuần học thành công."]);
} elseif (preg_match('#^/weeks/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $w_id = $matches[1];
    $stmt = $conn->prepare("DELETE FROM course_weeks WHERE id = ?");
    $stmt->bind_param("i", $w_id);
    $stmt->execute();
    jsonResponse(["message" => "Xóa tuần học thành công."]);
} elseif (preg_match('#^/weeks/([^/]+)/lessons$#', $pathInfo, $matches) && $method === 'POST') {
    $w_id = $matches[1];
    $title = $input['title'] ?? 'Bài học mới';
    $type = $input['type'] ?? 'video';
    $duration = 10;
    
    $stmt = $conn->prepare("INSERT INTO lessons (week_id, type, title, duration) VALUES (?, ?, ?, ?)");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
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
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("sssssssss", $title, $video_url, $description, $quiz_question, $quiz_option_a, $quiz_option_b, $quiz_correct_answer, $flag, $l_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật bài học thành công."]);
} elseif (preg_match('#^/lessons/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $l_id = $matches[1];
    $stmt = $conn->prepare("DELETE FROM lessons WHERE id = ?");
    $stmt->bind_param("i", $l_id);
    $stmt->execute();
    jsonResponse(["message" => "Xóa bài học thành công."]);

} elseif ($pathInfo === '/discounts' && $method === 'GET') {
    $discounts = [];
    $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
    addColumnIfMissing($conn, 'discount_codes', 'starts_at', 'DATETIME NULL AFTER discount_rate');
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
    $offset = ($page - 1) * $limit;
    $search = $_GET['search'] ?? '';

    $where_clauses = [];
    $params = [];
    $types = "";

    if (!empty($search)) {
        $where_clauses[] = "code LIKE ?";
        $params[] = "%{$search}%";
        $types .= "s";
    }
    $where_sql = count($where_clauses) > 0 ? "WHERE " . implode(" AND ", $where_clauses) : "";

    $total_stmt = $conn->prepare("SELECT COUNT(*) as total FROM discount_codes $where_sql");
    if (!empty($types)) bindDynamicParams($total_stmt, $types, $params);
    $total_stmt->execute();
    $total_records = $total_stmt->get_result()->fetch_assoc()['total'];

    $stmt = $conn->prepare("SELECT * FROM discount_codes $where_sql ORDER BY id DESC LIMIT ? OFFSET ?");
    array_push($params, $limit, $offset);
    $types .= "ii";
    bindDynamicParams($stmt, $types, $params);
    $stmt->execute();
    $res = $stmt->get_result();
    if (!$res) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['discount_rate'] = floatval($row['discount_rate']);
            $discounts[] = $row;
        }
    }
    jsonResponse(["discounts" => $discounts, "totalRecords" => $total_records]);
} elseif ($pathInfo === '/discounts' && $method === 'POST') {
    $code = strtoupper(trim($input['code'] ?? '')); $rate = floatval($input['rate'] ?? 0) / 100.0;
    $expires_at = !empty($input['expires_at']) ? $input['expires_at'] : null;
    $starts_at = !empty($input['starts_at']) ? $input['starts_at'] : null;
    
    $stmt = $conn->prepare("SELECT id FROM discount_codes WHERE code = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("s", $code);
    $stmt->execute();
    if ($stmt->fetch()) {
        $stmt->close();
        jsonResponse(["message" => "Mã này đã tồn tại!"], 409);
    }
    $stmt->close();
    
    $stmt = $conn->prepare("INSERT INTO discount_codes (code, discount_rate, starts_at, expires_at) VALUES (?, ?, ?, ?)");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("sdss", $code, $rate, $starts_at, $expires_at);
    $stmt->execute();
    jsonResponse(["message" => "Thêm mã giảm giá thành công."], 201);
} elseif (preg_match('#^/discounts/([^/]+)$#', $pathInfo, $matches) && $method === 'DELETE') {
    $disc_id = $matches[1];
    $stmt = $conn->prepare("DELETE FROM discount_codes WHERE id = ?");
    $stmt->bind_param("i", $disc_id);
    $stmt->execute();
    jsonResponse(["message" => "Xóa mã giảm giá thành công."]);
} elseif (preg_match('#^/discounts/([^/]+)$#', $pathInfo, $matches) && $method === 'PUT') {
    $disc_id = $matches[1];
    $is_active = isset($input['is_active']) ? (int)$input['is_active'] : 1;
    $stmt = $conn->prepare("UPDATE discount_codes SET is_active = ? WHERE id = ?");
    if (!$stmt) jsonResponse(["message" => "Lỗi Database: " . $conn->error], 500);
    $stmt->bind_param("is", $is_active, $disc_id);
    $stmt->execute();
    jsonResponse(["message" => "Cập nhật trạng thái thành công."]);

} elseif ($pathInfo === '/upload' && $method === 'POST') {
    if (!isset($_FILES['file'])) jsonResponse(['message' => 'Không tìm thấy file.'], 400);
    if (isVercelRuntime()) {
        jsonResponse([
            'message' => 'Upload file vao local disk khong ho tro tren Vercel. Hay dung Vercel Blob, S3, Cloudinary, hoac mot storage ngoai.'
        ], 501);
    }
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK) jsonResponse(['message' => 'Lỗi upload file.'], 400);
    
    $upload_dir = getPublicUploadDir();
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
    
    $filename = basename($file['name']);
    $filename = preg_replace("/[^a-zA-Z0-9.-]/", "_", $filename);
    $unique_filename = uniqid() . '_' . $filename;
    
    $filepath = $upload_dir . $unique_filename;
    if (move_uploaded_file($file['tmp_name'], $filepath)) {
        $file_url = getPublicUploadUrl($unique_filename);
        jsonResponse(['message' => 'Upload thành công', 'url' => $file_url]);
    } else {
        jsonResponse(['message' => 'Lưu file thất bại.'], 500);
    }
}

jsonResponse(["message" => "API chưa được xây dựng: " . $pathInfo], 404);
?>
